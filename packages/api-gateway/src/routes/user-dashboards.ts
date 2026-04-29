/**
 * User Dashboard routes — CRUD + refresh + preview.
 *
 * Endpoints:
 *   GET    /user-dashboards              — list all dashboards
 *   POST   /user-dashboards/preview      — dry-run: agent + widget gen, no DB save
 *   POST   /user-dashboards              — create (triggers initial run + LLM widget gen)
 *   GET    /user-dashboards/:slug        — get config + latest data
 *   PUT    /user-dashboards/:slug        — update config
 *   DELETE /user-dashboards/:slug        — delete
 *   POST   /user-dashboards/:slug/refresh  — re-run agent, update lastData
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient, Prisma } from '@prisma/client';

import { CreateUserDashboardSchema, UpdateUserDashboardSchema, ok, err, ErrorCodes } from '@bex/shared';
import { OrchestratorService } from '@bex/orchestrator';
import { createAgentQueue } from '@bex/scheduler';
import { resolveUserId } from '../user-resolver.js';
import { generateWidgets } from '../widget-generator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** How long to wait for a synchronous agent run before switching to background mode. */
const SYNC_TIMEOUT_MS = 25_000;

/** Rejects after ms with a sentinel error so the caller can switch to provisioning mode. */
function syncTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(Object.assign(new Error('Agent run is taking longer than expected — completing in background'), { isTimeout: true })), ms),
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Pick the best agent for a prompt by scoring agents against keyword matches
 * in their name, description, and the domains of their published skills.
 * Falls back to the default agent if no strong match is found.
 */
async function resolveBestAgent(prisma: PrismaClient, prompt: string): Promise<string | null> {
  const promptLower = prompt.toLowerCase();

  const agents = await prisma.agent.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      description: true,
      isDefault: true,
      agentSkills: {
        select: {
          skill: { select: { domain: true, name: true, status: true } },
        },
      },
    },
  });

  if (agents.length === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  let defaultId: string | null = null;

  for (const agent of agents) {
    if (agent.isDefault) defaultId = agent.id;

    const searchable = [
      agent.name,
      agent.description ?? '',
      ...agent.agentSkills
        .filter((as) => as.skill.status === 'PUBLISHED')
        .flatMap((as) => [as.skill.domain, as.skill.name]),
    ].join(' ').toLowerCase();

    // Split prompt into meaningful words (≥4 chars) and count hits
    const words = promptLower.match(/\b\w{4,}\b/g) ?? [];
    const score = words.reduce((n, w) => n + (searchable.includes(w) ? 1 : 0), 0);

    if (score > bestScore) {
      bestScore = score;
      bestId = agent.id;
    }
  }

  // Only use the keyword match if it scored at least 1 hit; otherwise fall back to default
  return (bestScore > 0 ? bestId : defaultId) ?? defaultId;
}

/**
 * Run an agent synchronously (via OrchestratorService) and return the output.
 * Also persists an AgentRequest record for the audit trail.
 */
async function runAgentForDashboard(
  prisma: PrismaClient,
  agentId: string,
  userId: string,
  prompt: string,
): Promise<{ output: string; requestId: string }> {
  const orchestrator = new OrchestratorService(prisma);
  const queue = createAgentQueue();

  const agentRequest = await prisma.agentRequest.create({
    data: {
      agentId,
      userId,
      status: 'QUEUED',
      input: prompt,
      channel: 'dashboard',
    },
    select: { id: true },
  });

  await prisma.agentRequest.update({
    where: { id: agentRequest.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  let output = '';
  try {
    const result = await orchestrator.execute({
      requestId: agentRequest.id,
      agentId,
      userId,
      input: prompt,
      channel: 'dashboard',
    });
    output = result.output;
    await prisma.agentRequest.update({
      where: { id: agentRequest.id },
      data: { status: 'COMPLETED', output, completedAt: new Date() },
    });
  } catch (runErr) {
    const msg = runErr instanceof Error ? runErr.message : String(runErr);
    // Wrap the DB update in its own try/catch so a Prisma conflict never swallows the original error
    try {
      await prisma.agentRequest.update({
        where: { id: agentRequest.id },
        data: { status: 'FAILED', errorMsg: msg, completedAt: new Date() },
      });
    } catch {
      // Ignore — orchestrator may have already marked this as FAILED
    }
    throw runErr;
  }

  // Also enqueue the job in BullMQ for any downstream listeners (optional)
  try { await queue.add(`dashboard-${agentRequest.id}`, { requestId: agentRequest.id, agentId, userId, input: prompt, channel: 'dashboard' }); } catch {}

  return { output, requestId: agentRequest.id };
}

/** Attempt to parse JSON out of agent output for caching as lastData. */
function parseLastData(output: string): unknown {
  // Direct parse
  try { return JSON.parse(output.trim()); } catch {}
  // Fenced JSON block ```json ... ```
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  // Bare JSON object/array anywhere in the text
  const objMatch = output.match(/(\{[\s\S]*\})/);
  if (objMatch?.[1]) { try { return JSON.parse(objMatch[1]); } catch {} }
  const arrMatch = output.match(/(\[[\s\S]*\])/);
  if (arrMatch?.[1]) { try { return JSON.parse(arrMatch[1]); } catch {} }
  return { _text: output };
}

/**
 * Returns true when lastData is the prose fallback (agent returned markdown/text instead of JSON).
 * Widget generators should produce text-friendly layouts and not invent JSON keys.
 */
function isTextFallback(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    Object.keys(data as object).length === 1 &&
    '_text' in (data as object)
  );
}

/**
 * Wraps a user prompt with an explicit JSON output directive so agents always
 * return structured data suitable for dashboard widget rendering.
 */
function withJsonDirective(prompt: string): string {
  const lower = prompt.toLowerCase();
  // Don't double-add if user already mentioned JSON
  if (lower.includes('json') || lower.includes('structured')) return prompt;
  return `${prompt.trimEnd()}\n\nReturn your response as a JSON object only — no markdown, no prose, no headers. Use clear snake_case field names. Arrays of objects should be flat with consistent keys.`;
}

// ─── Background provisioning ──────────────────────────────────────────────────

/**
 * Fire-and-forget: waits briefly for registry skill acquisition, then retries
 * the agent run. Updates dashboard status to 'active' on success or 'error' after
 * exhausting retries.
 */
async function backgroundProvision(
  prisma: PrismaClient,
  dashboardId: string,
  agentId: string,
  userId: string,
  prompt: string,
  name: string,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  const DELAY_MS = 15_000; // 15 s between attempts — gives registry time to respond

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));

    try {
      const orchestrator = new OrchestratorService(prisma);
      const agentRequest = await prisma.agentRequest.create({
        data: { agentId, userId, status: 'RUNNING', input: prompt, channel: 'dashboard', startedAt: new Date() },
        select: { id: true },
      });

      const result = await orchestrator.execute({
        requestId: agentRequest.id,
        agentId,
        userId,
        input: prompt,
        channel: 'dashboard',
      });

      const lastData = parseLastData(result.output);
      const widgets = await generateWidgets(result.output, name, prompt).catch(() => [] as unknown[]);

      await prisma.userDashboard.update({
        where: { id: dashboardId },
        data: {
          status: 'active',
          lastData: lastData as Prisma.InputJsonValue,
          lastRunAt: new Date(),
          widgets: widgets as Prisma.InputJsonValue,
          meta: { provisioningMessage: null, completedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      });

      console.info(`[user-dashboards] Background provisioning succeeded (attempt ${attempt}): dashboard ${dashboardId}`);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[user-dashboards] Provisioning attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`);

      if (attempt === MAX_ATTEMPTS) {
        await prisma.userDashboard.update({
          where: { id: dashboardId },
          data: {
            status: 'error',
            meta: {
              provisioningMessage: `Failed after ${MAX_ATTEMPTS} attempts. Last error: ${msg}`,
              errorDetail: msg,
              failedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        }).catch(() => {});
      }
    }
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function userDashboardRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  // GET /user-dashboards — list all dashboards
  app.get('/user-dashboards', async (_request, reply) => {
    const dashboards = await prisma.userDashboard.findMany({
      where: { status: { not: 'archived' } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        agentId: true,
        refreshMode: true,
        cronExpr: true,
        status: true,
        meta: true,
        lastRunAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(dashboards));
  });

  // POST /user-dashboards/preview — dry-run: runs agent + generates widgets WITHOUT saving to DB.
  // Must be registered before the :slug routes to avoid the param catching "preview".
  app.post<{ Body: unknown }>('/user-dashboards/preview', async (request, reply) => {
    const parsed = CreateUserDashboardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const externalId = (request.user as { sub: string }).sub;
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));

    const { name, prompt } = parsed.data;
    let agentId = parsed.data.agentId ?? null;
    if (!agentId) {
      agentId = await resolveBestAgent(prisma, prompt);
      if (!agentId) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'No suitable agent found for this prompt'));
    }

    const enrichedPrompt = withJsonDirective(prompt);
    let output = '';
    let lastData: unknown = null;
    let widgets: unknown[] = [];
    let previewError: string | null = null;

    try {
      const result = await Promise.race([
        runAgentForDashboard(prisma, agentId, userId, enrichedPrompt),
        syncTimeout(SYNC_TIMEOUT_MS),
      ]);
      output = result.output;
      lastData = parseLastData(output);
      widgets = await generateWidgets(output, name, prompt);
    } catch (runErr) {
      previewError = runErr instanceof Error ? runErr.message : String(runErr);
      lastData = {};
      widgets = await generateWidgets('{}', name, prompt).catch(() => []);
    }

    // Summarise what data keys were found (top-level keys + array lengths)
    const dataKeys: Array<{ key: string; type: string; count?: number }> = [];
    if (lastData && typeof lastData === 'object' && !Array.isArray(lastData)) {
      for (const [k, v] of Object.entries(lastData as Record<string, unknown>)) {
        if (k === '_text') {
          dataKeys.push({ key: k, type: 'prose' });
        } else if (Array.isArray(v)) {
          dataKeys.push({ key: k, type: 'array', count: v.length });
        } else if (v && typeof v === 'object') {
          dataKeys.push({ key: k, type: 'object' });
        } else {
          dataKeys.push({ key: k, type: typeof v });
        }
      }
    }

    return reply.send(ok({
      agentId,
      widgets,
      dataKeys,
      dataPreview: lastData,
      previewError,
    }));
  });

  // POST /user-dashboards — create a new dashboard
  app.post<{ Body: unknown }>('/user-dashboards', async (request, reply) => {
    const parsed = CreateUserDashboardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const externalId = (request.user as { sub: string }).sub;
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));

    const { name, description, prompt, refreshMode, cronExpr } = parsed.data;

    // Derive slug
    let slug = parsed.data.slug ?? slugify(name);
    // Ensure uniqueness
    const existing = await prisma.userDashboard.findUnique({ where: { slug }, select: { id: true } });
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    // Resolve agent — try to pick the best match when not explicitly specified
    let agentId = parsed.data.agentId ?? null;
    if (!agentId) {
      agentId = await resolveBestAgent(prisma, prompt);
      if (!agentId) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'No agent specified and no suitable agent found'));
    }

    // Run the agent to get initial data
    let lastData: unknown = null;
    let widgets = parsed.data.widgets ?? [];
    let lastRunAt: Date | null = null;
    let dashboardStatus = 'active';
    let meta: Record<string, unknown> | null = null;
    const enrichedPrompt = withJsonDirective(prompt);

    try {
      const { output } = await Promise.race([
        runAgentForDashboard(prisma, agentId, userId, enrichedPrompt),
        syncTimeout(SYNC_TIMEOUT_MS),
      ]);
      lastData = parseLastData(output);
      lastRunAt = new Date();

      // If agent still returned prose, log a warning — widgets will show text fallback
      if (isTextFallback(lastData)) {
        console.warn(`[user-dashboards] Agent returned prose for dashboard "${name}" — text fallback active`);
      }

      // Auto-generate widgets if not provided
      if (widgets.length === 0) {
        widgets = await generateWidgets(output, name, prompt);
      }
    } catch (runErr) {
      // Non-fatal: create dashboard in provisioning state, then acquire skills + retry in background
      const msg = runErr instanceof Error ? runErr.message : String(runErr);
      const isTimeout = (runErr as { isTimeout?: boolean }).isTimeout === true;
      console.warn('[user-dashboards] Initial agent run failed — entering provisioning state:', msg);
      dashboardStatus = 'provisioning';
      meta = {
        provisioningMessage: isTimeout
          ? 'This dashboard is fetching live data — it will update automatically in a few moments.'
          : 'Required skills are being acquired. Data will appear once provisioning completes.',
        errorDetail: msg,
        startedAt: new Date().toISOString(),
      };
      widgets = await generateWidgets('{}', name, prompt).catch(() => [
        { id: 'w1', type: 'table' as const, title: 'Data', dataKey: '_text', columns: ['value'], colSpan: 4 },
        { id: 'w2', type: 'actions' as const, actions: [{ label: 'Refresh', action: 'refresh' as const, style: 'primary' as const }], colSpan: 1 },
      ]);
    }

    const dashboard = await prisma.userDashboard.create({
      data: {
        slug,
        name,
        description: description ?? null,
        agentId: agentId ?? null,
        prompt,
        widgets: widgets as Prisma.InputJsonValue,
        refreshMode: refreshMode ?? 'manual',
        cronExpr: cronExpr ?? null,
        lastData: lastData != null ? (lastData as Prisma.InputJsonValue) : Prisma.JsonNull,
        lastRunAt: lastRunAt ?? null,
        status: dashboardStatus,
        meta: meta != null ? (meta as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    // Fire-and-forget background provisioning when initial run failed
    if (dashboardStatus === 'provisioning') {
      void backgroundProvision(prisma, dashboard.id, agentId, userId, enrichedPrompt, name);
    }

    return reply.status(201).send(ok(dashboard));
  });

  // GET /user-dashboards/:slug — get full config + cached data
  app.get<{ Params: { slug: string } }>('/user-dashboards/:slug', async (request, reply) => {
    const { slug } = request.params;
    const dashboard = await prisma.userDashboard.findUnique({ where: { slug } });
    if (!dashboard) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Dashboard not found'));
    return reply.send(ok(dashboard));
  });

  // PUT /user-dashboards/:slug — update config
  app.put<{ Params: { slug: string }; Body: unknown }>('/user-dashboards/:slug', async (request, reply) => {
    const { slug } = request.params;
    const parsed = UpdateUserDashboardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const existing = await prisma.userDashboard.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Dashboard not found'));

    const { widgets, name, description, agentId, prompt, refreshMode, cronExpr, status } = parsed.data;
    const updated = await prisma.userDashboard.update({
      where: { slug },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description: description ?? null } : {}),
        ...(agentId !== undefined ? { agentId: agentId ?? null } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
        ...(refreshMode !== undefined ? { refreshMode } : {}),
        ...(cronExpr !== undefined ? { cronExpr: cronExpr ?? null } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(widgets !== undefined ? { widgets: widgets as Prisma.InputJsonValue } : {}),
      },
    });

    return reply.send(ok(updated));
  });

  // DELETE /user-dashboards/:slug — delete
  app.delete<{ Params: { slug: string } }>('/user-dashboards/:slug', async (request, reply) => {
    const { slug } = request.params;
    const existing = await prisma.userDashboard.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Dashboard not found'));
    await prisma.userDashboard.delete({ where: { slug } });
    return reply.status(204).send();
  });

  // POST /user-dashboards/:slug/refresh — re-run the agent and update cached data
  app.post<{ Params: { slug: string } }>('/user-dashboards/:slug/refresh', async (request, reply) => {
    const { slug } = request.params;

    const dashboard = await prisma.userDashboard.findUnique({ where: { slug } });
    if (!dashboard) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Dashboard not found'));
    if (dashboard.status === 'archived') {
      return reply.status(400).send(err('DASHBOARD_ARCHIVED', 'Cannot refresh an archived dashboard'));
    }

    // Resolve user — fall back to system user when called from the unauthenticated viewer
    const externalId = (request.user as { sub?: string } | undefined)?.sub ?? 'system';
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));

    const agentId = dashboard.agentId;
    if (!agentId) return reply.status(400).send(err('NO_AGENT', 'Dashboard has no agent configured'));

    let output: string;
    let requestId: string;
    try {
      ({ output, requestId } = await runAgentForDashboard(prisma, agentId, userId, withJsonDirective(dashboard.prompt)));
    } catch (runErr) {
      const msg = runErr instanceof Error ? runErr.message : String(runErr);
      return reply.status(500).send(err(ErrorCodes.INTERNAL, `Agent run failed: ${msg}`));
    }

    const lastData = parseLastData(output);

    const updated = await prisma.userDashboard.update({
      where: { slug },
      data: { lastData: lastData as Prisma.InputJsonValue, lastRunAt: new Date() },
    });

    return reply.send(ok({ ...updated, requestId }));
  });

  // POST /user-dashboards/:slug/regenerate-widgets — re-generate widget layout from latest data
  app.post<{ Params: { slug: string } }>('/user-dashboards/:slug/regenerate-widgets', async (request, reply) => {
    const { slug } = request.params;
    const dashboard = await prisma.userDashboard.findUnique({ where: { slug } });
    if (!dashboard) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Dashboard not found'));

    const externalId = (request.user as { sub: string }).sub;
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));

    const agentId = dashboard.agentId;
    if (!agentId) return reply.status(400).send(err('NO_AGENT', 'Dashboard has no agent configured'));

    let output: string;
    try {
      ({ output } = await runAgentForDashboard(prisma, agentId, userId, withJsonDirective(dashboard.prompt)));
    } catch (runErr) {
      const msg = runErr instanceof Error ? runErr.message : String(runErr);
      return reply.status(500).send(err(ErrorCodes.INTERNAL, `Agent run failed: ${msg}`));
    }

    const lastData = parseLastData(output);
    const widgets = await generateWidgets(output, dashboard.name, dashboard.prompt);

    const updated = await prisma.userDashboard.update({
      where: { slug },
      data: { widgets: widgets as Prisma.InputJsonValue, lastData: lastData as Prisma.InputJsonValue, lastRunAt: new Date() },
    });

    return reply.send(ok(updated));
  });
}
