import { createHash } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { listSkills, getSkill, upsertSkill, deleteSkill } from './db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type SkillManifest = {
  name: string;
  domain: string;
  version: string;
  description?: string;
  capabilities: string[];
  tools: unknown[];
  systemPrompt?: string;
  checksum: string;
  publishedBy?: string;
  publishedAt: string;
};

function ok<T>(data: T) {
  return { ok: true, data };
}

function badRequest(res: Response, message: string) {
  return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message } });
}

function notFound(res: Response) {
  return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Skill not found' } });
}

function unauthorized(res: Response) {
  return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response): boolean {
  const token = process.env['REGISTRY_AUTH_TOKEN'];
  if (!token) return true; // Auth not required if env var not set

  const header = req.headers['authorization'] ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided !== token) {
    unauthorized(res);
    return false;
  }
  return true;
}

/**
 * Admin-level auth — required for destructive operations (DELETE).
 * Checks REGISTRY_ADMIN_TOKEN if set; falls back to REGISTRY_AUTH_TOKEN.
 * This allows a separate high-privilege token for skill deletion.
 */
function requireAdminAuth(req: Request, res: Response): boolean {
  const adminToken = process.env['REGISTRY_ADMIN_TOKEN'];
  if (!adminToken) {
    // No dedicated admin token — fall back to regular auth token
    return requireAuth(req, res);
  }
  const header = req.headers['authorization'] ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided !== adminToken) {
    unauthorized(res);
    return false;
  }
  return true;
}

// ─── Checksum ─────────────────────────────────────────────────────────────────

function computeChecksum(tools: unknown[], systemPrompt?: string): string {
  const payload = JSON.stringify({ tools, systemPrompt: systemPrompt ?? '' });
  return createHash('sha256').update(payload).digest('hex');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function buildRouter(): Router {
  const router = createRouter();

  // GET /health
  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'bex-skill-registry' });
  });

  // GET /registry/skills
  router.get('/registry/skills', (req, res) => {
    const domain = typeof req.query['domain'] === 'string' ? req.query['domain'] : undefined;
    const skills = listSkills(domain);
    res.json(ok(skills.map(s => ({
      domain: s.domain,
      version: s.version,
      name: s.name,
      description: s.description,
      checksum: s.checksum,
      published_at: s.published_at,
    }))));
  });

  // GET /registry/skills/:domain/:version
  router.get('/registry/skills/:domain/:version', (req, res) => {
    const { domain, version } = req.params as { domain: string; version: string };
    const row = getSkill(domain, version);
    if (!row) return notFound(res);

    let manifest: unknown;
    try {
      manifest = JSON.parse(row.manifest);
    } catch {
      manifest = row.manifest;
    }
    return res.json(ok(manifest));
  });

  // POST /registry/publish
  router.post('/registry/publish', (req, res) => {
    if (!requireAuth(req, res)) return;

    const body = req.body as Partial<SkillManifest>;

    if (!body.domain || !body.version || !body.name || !Array.isArray(body.tools)) {
      return badRequest(res, 'manifest must include name, domain, version, and tools');
    }

    const checksum = computeChecksum(body.tools, body.systemPrompt);

    upsertSkill({
      domain: body.domain,
      version: body.version,
      name: body.name,
      description: body.description ?? null,
      checksum,
      manifest: JSON.stringify({ ...body, checksum }),
    });

    return res.status(201).json(ok({
      domain: body.domain,
      version: body.version,
      url: `/registry/skills/${body.domain}/${body.version}`,
    }));
  });

  // DELETE /registry/skills/:domain/:version
  router.delete('/registry/skills/:domain/:version', (req, res) => {
    if (!requireAdminAuth(req, res)) return;

    const { domain, version } = req.params as { domain: string; version: string };
    const existing = getSkill(domain, version);
    if (!existing) return notFound(res);

    deleteSkill(domain, version);
    return res.json(ok({ deleted: true }));
  });

  return router;
}
