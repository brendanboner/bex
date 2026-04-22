/**
 * User Dashboard routes — CRUD + refresh.
 *
 * Endpoints:
 *   GET    /user-dashboards           — list all dashboards
 *   POST   /user-dashboards           — create (triggers initial run + LLM widget gen)
 *   GET    /user-dashboards/:slug     — get config + latest data
 *   PUT    /user-dashboards/:slug     — update config
 *   DELETE /user-dashboards/:slug     — delete
 *   POST   /user-dashboards/:slug/refresh  — re-run agent, update lastData
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient, Prisma } from '@prisma/client';

import { CreateUserDashboardSchema, UpdateUserDashboardSchema, ok, err, ErrorCodes } from '@bclaw/shared';
import { OrchestratorService } from '@bclaw/orchestrator';
import { createAgentQueue } from '@bclaw/scheduler';
import { resolveUserId } from '../user-resolver.js';
import { generateWidgets } from '../widget-generator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
        lastRunAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(dashboards));
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
    const enrichedPrompt = withJsonDirective(prompt);

    try {
      const { output } = await runAgentForDashboard(prisma, agentId, userId, enrichedPrompt);
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
      // Non-fatal: create dashboard with empty data + fallback widgets
      console.error('[user-dashboards] Initial agent run failed:', runErr);
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
        status: 'active',
      },
    });

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
