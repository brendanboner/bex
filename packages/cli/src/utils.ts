import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
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
  console.log(chalk.bold.magenta('╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.magenta('║') + chalk.bold.white('   Forge — Enterprise Agentic Platform               ') + chalk.bold.magenta('║'));
  console.log(chalk.bold.magenta('║') + chalk.dim('   Autonomous agents. Domain skills. Secure by design.') + chalk.bold.magenta('║'));
  console.log(chalk.bold.magenta('╚══════════════════════════════════════════════════════╝'));
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

// ── pm2-based service management ────────────────────────────────────────────

const ECOSYSTEM_FILE = 'ecosystem.config.cjs';

/** Ensure the dashboard standalone build + static assets are in place. */
export function ensureDashboardBuilt(root: string): boolean {
  const standalone = resolve(root, 'apps/dashboard/.next/standalone/apps/dashboard/server.js');
  if (!existsSync(standalone)) return false;
  // Sync static assets (safe to run every time)
  try {
    spawnSync('cp', ['-r',
      resolve(root, 'apps/dashboard/.next/static'),
      resolve(root, 'apps/dashboard/.next/standalone/apps/dashboard/.next/static'),
    ], { stdio: 'pipe' });
  } catch { /* ignore */ }
  return true;
}

/** Start or restart all services via pm2. */
export function startLocalServices(root: string): void {
  mkdirSync(resolve(root, 'logs'), { recursive: true });
  ensureDashboardBuilt(root);
  const eco = resolve(root, ECOSYSTEM_FILE);
  // If pm2 already knows about bex apps, restart them; otherwise start fresh.
  const existing = spawnSync('pm2', ['id', 'bex-api'], { stdio: 'pipe', encoding: 'utf-8' });
  const alreadyRunning = existing.stdout?.includes('bex-api');
  if (alreadyRunning) {
    spawnSync('pm2', ['restart', eco], { stdio: 'inherit', cwd: root });
  } else {
    spawnSync('pm2', ['start', eco], { stdio: 'inherit', cwd: root });
  }
}

/** Stop all bex services via pm2. */
export function stopLocalServices(): void {
  try {
    const root = findProjectRoot();
    spawnSync('pm2', ['stop', resolve(root, ECOSYSTEM_FILE)], { stdio: 'pipe' });
  } catch { /* ignore if pm2 not running */ }
}

/** Restart a single named pm2 app (e.g. 'bex-dashboard'). */
export function restartService(name: string): void {
  spawnSync('pm2', ['restart', name], { stdio: 'inherit' });
}

/** Show pm2 status table. */
export function showServiceStatus(): void {
  spawnSync('pm2', ['status'], { stdio: 'inherit' });
}

// Legacy stubs — kept so existing callers compile but now delegate to pm2
export function stopPort(_port: number): void { /* no-op: pm2 manages PIDs */ }
export function spawnService(_script: string, _env: Record<string, string>, _log: string, _cwd: string): undefined { return undefined; }
export function getServiceDefs(_root: string, _env: Record<string, string>): never[] { return []; }

export function ensureInfraRunning(root: string): void {
  if (!isDockerRunning()) return;
  const composePath = resolve(root, 'infra', 'docker-compose.yml');
  // Only start postgres+redis, not app services
  spawnSync('docker', ['compose', '-f', composePath, 'up', '-d', 'postgres', 'redis'], {
    stdio: 'pipe',
    cwd: root,
  });
}

