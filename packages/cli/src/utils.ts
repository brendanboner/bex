import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync, spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';

export interface ServiceDef {
  name: string;
  port?: number;
  logFile: string;
  /** node script to run */
  script: string;
  /** extra env vars for this service */
  env: (rootEnv: Record<string, string>, root: string) => Record<string, string>;
}

// Walk up from current working directory to find project root (contains infra/docker-compose.yml)
export function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'infra', 'docker-compose.yml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find project root (no infra/docker-compose.yml found)');
}

export function getEnvPath(): string {
  return resolve(findProjectRoot(), '.env');
}

export function readEnv(): Record<string, string> {
  const envPath = getEnvPath();
  if (!existsSync(envPath)) return {};
  const raw = readFileSync(envPath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

export function writeEnv(vars: Record<string, string>): void {
  const envPath = getEnvPath();
  const existing = readEnv();
  const merged = { ...existing, ...vars };
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

export function generateSecretSync(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function isDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function composeCommand(args: string[], projectRoot: string): ReturnType<typeof spawnSync> {
  const composePath = resolve(projectRoot, 'infra', 'docker-compose.yml');
  return spawnSync('docker', ['compose', '-f', composePath, ...args], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
}

export function printBanner(): void {
  console.log('');
  console.log(chalk.bold.cyan('╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║') + chalk.bold.white('   Forge — Enterprise Agentic Platform               ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + chalk.dim('   Autonomous agents. Domain skills. Secure by design.') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════╝'));
  console.log('');
}

export function printSuccess(message: string): void {
  console.log(chalk.green('  ✓') + ' ' + message);
}

export function printWarning(message: string): void {
  console.log(chalk.yellow('  ⚠') + ' ' + message);
}

export function printError(message: string): void {
  console.log(chalk.red('  ✗') + ' ' + message);
}

export async function waitForService(
  url: string,
  label: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  const start = Date.now();
  const { default: fetch } = await import('node-fetch');
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        printSuccess(`${label} ready`);
        return true;
      }
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  printError(`${label} did not respond within ${timeoutMs / 1000}s`);
  return false;
}

// ── Local service management (non-Docker) ───────────────────────────────────

export function stopPort(port: number): void {
  try {
    const pids = execSync(`lsof -ti ":${port}" 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
    if (pids) {
      pids.split(/\s+/).filter(Boolean).forEach((pid) => {
        try { execSync(`kill ${pid} 2>/dev/null || true`); } catch { /* ignore */ }
      });
    }
  } catch { /* ignore */ }
}

export function stopLocalServices(): void {
  [4000, 4001, 5050, 3000].forEach(stopPort);
}

/** Spawn a detached Node.js service writing stdout+stderr to logFile. Returns PID. */
export function spawnService(
  script: string,
  env: Record<string, string>,
  logFile: string,
  cwd: string,
): number | undefined {
  mkdirSync(resolve(cwd, 'logs'), { recursive: true });
  // Open synchronously so the fd is valid before spawn reads it
  const fd = openSync(logFile, 'w');
  const child = spawn('node', [script], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...env },
    cwd,
  });
  child.unref();
  // Parent can close its copy — child has inherited its own fd
  closeSync(fd);
  return child.pid;
}

/** Spawn Next.js dashboard (uses npx next dev) */
export function spawnDashboard(
  dashDir: string,
  logFile: string,
  port = 3000,
): number | undefined {
  mkdirSync(resolve(dashDir, '..', '..', 'logs'), { recursive: true });
  const fd = openSync(logFile, 'w');
  const child = spawn('node_modules/.bin/next', ['dev', '-p', String(port)], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, NODE_ENV: 'development' },
    cwd: dashDir,
  });
  child.unref();
  closeSync(fd);
  return child.pid;
}

/** Returns the 5 service definitions for local startup */
export function getServiceDefs(root: string, env: Record<string, string>): Array<{
  name: string;
  port?: number;
  logFile: string;
  start: () => number | undefined;
}> {
  const logsDir = resolve(root, 'logs');
  const tok = env['SKILL_REGISTRY_TOKEN'] ?? 'forge-registry-dev';
  return [
    {
      name: 'Skill Registry',
      port: 5050,
      logFile: resolve(logsDir, 'skill-registry.log'),
      start: () => spawnService(
        resolve(root, 'packages/skill-registry/dist/server.js'),
        {
          PORT: '5050',
          DATA_DIR: resolve(root, 'packages/skill-registry/data'),
          REGISTRY_AUTH_TOKEN: tok,
          REGISTRY_ADMIN_TOKEN: env['REGISTRY_ADMIN_TOKEN'] ?? '',
        },
        resolve(logsDir, 'skill-registry.log'),
        root,
      ),
    },
    {
      name: 'API Gateway',
      port: 4000,
      logFile: resolve(logsDir, 'api-gateway.log'),
      start: () => spawnService(
        resolve(root, 'packages/api-gateway/dist/server.js'),
        {
          SKILL_REGISTRY_URL: env['SKILL_REGISTRY_URL'] ?? 'http://localhost:5050',
          SKILL_REGISTRY_TOKEN: tok,
          DATABASE_URL: env['DATABASE_URL'] ?? '',
          REDIS_URL: env['REDIS_URL'] ?? 'redis://localhost:6379',
          JWT_SECRET: env['JWT_SECRET'] ?? '',
          CREDENTIAL_VAULT_KEY: env['CREDENTIAL_VAULT_KEY'] ?? '',
          CORS_ORIGIN: env['CORS_ORIGIN'] ?? 'http://localhost:3000',
          OPENAI_API_KEY: env['OPENAI_API_KEY'] ?? '',
        },
        resolve(logsDir, 'api-gateway.log'),
        root,
      ),
    },
    {
      name: 'Admin API',
      port: 4001,
      logFile: resolve(logsDir, 'admin-api.log'),
      start: () => spawnService(
        resolve(root, 'packages/dashboard-api/dist/server.js'),
        {
          ADMIN_API_PORT: '4001',
          DATABASE_URL: env['DATABASE_URL'] ?? '',
          REDIS_URL: env['REDIS_URL'] ?? 'redis://localhost:6379',
          JWT_SECRET: env['JWT_SECRET'] ?? '',
          CORS_ORIGIN: env['CORS_ORIGIN'] ?? 'http://localhost:3000',
        },
        resolve(logsDir, 'admin-api.log'),
        root,
      ),
    },
    {
      name: 'Worker',
      logFile: resolve(logsDir, 'worker.log'),
      start: () => spawnService(
        resolve(root, 'packages/scheduler/dist/worker.js'),
        {
          DATABASE_URL: env['DATABASE_URL'] ?? '',
          REDIS_URL: env['REDIS_URL'] ?? 'redis://localhost:6379',
          CREDENTIAL_VAULT_KEY: env['CREDENTIAL_VAULT_KEY'] ?? '',
          OPENAI_API_KEY: env['OPENAI_API_KEY'] ?? '',
          ANTHROPIC_API_KEY: env['ANTHROPIC_API_KEY'] ?? '',
          AZURE_OPENAI_API_KEY: env['AZURE_OPENAI_API_KEY'] ?? '',
          AZURE_OPENAI_RESOURCE_NAME: env['AZURE_OPENAI_RESOURCE_NAME'] ?? '',
          JWT_SECRET: env['JWT_SECRET'] ?? '',
          SKILL_REGISTRY_URL: env['SKILL_REGISTRY_URL'] ?? 'http://localhost:5050',
          SKILL_REGISTRY_TOKEN: tok,
          DEFAULT_APPROVAL_CHANNEL: env['DEFAULT_APPROVAL_CHANNEL'] ?? 'telegram',
          TELEGRAM_BOT_TOKEN: env['TELEGRAM_BOT_TOKEN'] ?? '',
        },
        resolve(logsDir, 'worker.log'),
        root,
      ),
    },
    {
      name: 'Dashboard',
      port: 3000,
      logFile: resolve(logsDir, 'dashboard.log'),
      start: () => spawnDashboard(
        resolve(root, 'apps/dashboard'),
        resolve(logsDir, 'dashboard.log'),
        3000,
      ),
    },
    {
      name: 'Telegram Bot',
      logFile: resolve(logsDir, 'telegram-bot.log'),
      start: () => {
        const botToken = env['TELEGRAM_BOT_TOKEN'] ?? '';
        if (!botToken) return undefined; // Skip if not configured
        return spawnService(
          resolve(root, 'integrations/telegram/dist/bot.js'),
          {
            TELEGRAM_BOT_TOKEN: botToken,
            TELEGRAM_DEFAULT_AGENT_ID: env['TELEGRAM_DEFAULT_AGENT_ID'] ?? '',
            API_GATEWAY_URL: env['API_GATEWAY_URL'] ?? 'http://localhost:4000',
            BFORGE_BOT_API_KEY: env['BFORGE_BOT_API_KEY'] ?? '',
          },
          resolve(logsDir, 'telegram-bot.log'),
          root,
        );
      },
    },
  ];
}

export function ensureInfraRunning(root: string): void {
  if (!isDockerRunning()) return;
  const composePath = resolve(root, 'infra', 'docker-compose.yml');
  // Only start postgres+redis, not app services
  spawnSync('docker', ['compose', '-f', composePath, 'up', '-d', 'postgres', 'redis'], {
    stdio: 'pipe',
    cwd: root,
  });
}

