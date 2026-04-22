/**
 * bex dashboard <subcommand>
 *
 * Commands:
 *   bex dashboard list                           — list all dashboards
 *   bex dashboard create <name> --prompt <text>  — create a new dashboard
 *   bex dashboard delete <slug>                  — delete a dashboard
 *   bex dashboard refresh <slug>                 — refresh dashboard data
 *   bex dashboard open <slug>                    — print the viewer URL
 */

import { Command } from 'commander';
import path from 'path';
import { readFileSync } from 'fs';
import { createHmac } from 'crypto';

function loadEnv(): Record<string, string> {
  try {
    const root = path.resolve(__dirname, '..', '..', '..', '..');
    const envPath = path.join(root, '.env');
    const raw = readFileSync(envPath, 'utf8');
    const env: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

/** Minimal HS256 JWT — no library required. */
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body   = b64({ ...payload, iat: Math.floor(Date.now() / 1000) });
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function getToken(env: Record<string, string>): string {
  // Prefer an explicit pre-signed token if provided
  const explicit = env['SYSTEM_JWT'] ?? process.env['SYSTEM_JWT'];
  if (explicit) return explicit;

  // Fall back: sign a system token from JWT_SECRET (same secret the gateway uses)
  const secret = env['JWT_SECRET'] ?? process.env['JWT_SECRET'];
  if (secret) return signJwt({ sub: 'system' }, secret);

  return '';
}

async function apiRequest<T>(
  env: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = env['API_URL'] ?? process.env['API_URL'] ?? 'http://localhost:4000';
  const token = getToken(env);

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return undefined as unknown as T;

  const json = (await res.json()) as { ok: boolean; data?: T; error?: { message?: string }; message?: string };
  if (!json.ok) throw new Error(json.error?.message ?? json.message ?? `API error ${res.status}`);
  return json.data as T;
}

type Dashboard = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  refreshMode: string;
  status: string;
  lastRunAt?: string;
};

export function buildDashboardCommand(): Command {
  const cmd = new Command('dashboard').description('Manage user dashboards');

  // bex dashboard list
  cmd
    .command('list')
    .description('List all dashboards')
    .action(async () => {
      const env = loadEnv();
      try {
        const dashboards = await apiRequest<Dashboard[]>(env, 'GET', '/user-dashboards');
        if (!dashboards || dashboards.length === 0) {
          console.log('No dashboards found.');
          return;
        }
        const viewerBase = env['DASHBOARD_VIEWER_URL'] ?? 'http://localhost:8801';
        console.log(`\n${'Name'.padEnd(30)} ${'Slug'.padEnd(25)} ${'Mode'.padEnd(12)} ${'Status'.padEnd(10)} Last Run`);
        console.log('─'.repeat(100));
        for (const d of dashboards) {
          const lastRun = d.lastRunAt ? new Date(d.lastRunAt).toLocaleString() : 'Never';
          console.log(
            `${d.name.padEnd(30)} ${d.slug.padEnd(25)} ${d.refreshMode.padEnd(12)} ${d.status.padEnd(10)} ${lastRun}`,
          );
        }
        console.log(`\nViewer: ${viewerBase}/`);
      } catch (e) {
        console.error('Error:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  // bex dashboard create <name>
  cmd
    .command('create <name>')
    .description('Create a new dashboard (runs agent immediately + auto-generates widget layout)')
    .requiredOption('-p, --prompt <text>', 'Prompt to send to the agent')
    .option('-a, --agent <id>', 'Agent ID (uses default agent if omitted)')
    .option('-d, --description <text>', 'Optional description')
    .option('--refresh <mode>', 'Refresh mode: manual | scheduled | realtime', 'manual')
    .option('--cron <expr>', 'Cron expression (for scheduled mode)')
    .action(async (name: string, opts: { prompt: string; agent?: string; description?: string; refresh: string; cron?: string }) => {
      const env = loadEnv();
      const viewerBase = env['DASHBOARD_VIEWER_URL'] ?? 'http://localhost:8801';
      console.log(`Creating dashboard "${name}"…`);
      console.log('Running agent (this may take a moment)…');
      try {
        const result = await apiRequest<Dashboard>(env, 'POST', '/user-dashboards', {
          name,
          description: opts.description,
          agentId: opts.agent,
          prompt: opts.prompt,
          refreshMode: opts.refresh,
          cronExpr: opts.cron,
        });
        console.log(`\n✓ Dashboard created!`);
        console.log(`  Name:    ${result.name}`);
        console.log(`  Slug:    ${result.slug}`);
        console.log(`  Status:  ${result.status}`);
        console.log(`  Viewer:  ${viewerBase}/${result.slug}`);
      } catch (e) {
        console.error('Error:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  // bex dashboard delete <slug>
  cmd
    .command('delete <slug>')
    .description('Delete a dashboard')
    .action(async (slug: string) => {
      const env = loadEnv();
      try {
        await apiRequest(env, 'DELETE', `/user-dashboards/${slug}`);
        console.log(`✓ Dashboard "${slug}" deleted.`);
      } catch (e) {
        console.error('Error:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  // bex dashboard refresh <slug>
  cmd
    .command('refresh <slug>')
    .description('Refresh dashboard data by re-running the agent')
    .action(async (slug: string) => {
      const env = loadEnv();
      console.log(`Refreshing "${slug}"…`);
      try {
        const result = await apiRequest<Dashboard>(env, 'POST', `/user-dashboards/${slug}/refresh`);
        console.log(`✓ Refreshed. Last run: ${result.lastRunAt ? new Date(result.lastRunAt).toLocaleString() : 'unknown'}`);
      } catch (e) {
        console.error('Error:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  // bex dashboard open <slug>
  cmd
    .command('open <slug>')
    .description('Print the viewer URL for a dashboard')
    .action((slug: string) => {
      const env = loadEnv();
      const viewerBase = env['DASHBOARD_VIEWER_URL'] ?? 'http://localhost:8801';
      console.log(`${viewerBase}/${slug}`);
    });

  return cmd;
}
