import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';

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
