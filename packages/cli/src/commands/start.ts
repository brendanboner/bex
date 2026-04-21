import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ora from 'ora';
import chalk from 'chalk';
import {
  findProjectRoot,
  readEnv,
  printError,
  printSuccess,
  printWarning,
  waitForService,
  startLocalServices,
  ensureDashboardBuilt,
  ensureInfraRunning,
} from '../utils.js';

function loadEnvFile(root: string): Record<string, string> {
  try {
    const raw = readFileSync(resolve(root, '.env'), 'utf8');
    const env: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
    return env;
  } catch { return {}; }
}

async function checkRegistrySync(root: string): Promise<void> {
  const env = loadEnvFile(root);
  const registryUrl = env['SKILL_REGISTRY_URL'] ?? '';
  const adminToken = env['ADMIN_TOKEN'] ?? env['BEX_BOT_API_KEY'] ?? '';
  const registryToken = env['SKILL_REGISTRY_TOKEN'] ?? '';
  if (!registryUrl) return;

  try {
    const { fetch } = await import('undici');
    const hdrs = (tok: string) => ({ 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) });

    const [localRes, remoteRes] = await Promise.all([
      fetch('http://localhost:4000/skills', { headers: hdrs(adminToken) }).catch(() => null),
      fetch(`${registryUrl}/registry/skills`, { headers: hdrs(registryToken) }).catch(() => null),
    ]);

    if (!localRes?.ok || !remoteRes?.ok) return;

    const localData  = await localRes.json()  as { data?: unknown[] };
    const remoteData = await remoteRes.json() as { data?: unknown[] };

    const localCount  = localData.data?.length  ?? 0;
    const remoteCount = remoteData.data?.length ?? 0;

    if (localCount > 0 && remoteCount === 0) {
      console.log('');
      console.log(chalk.yellow('  ⚠  Remote registry is empty but local DB has skills.'));
      console.log(chalk.dim(`     Push them with: ${chalk.white('bex skill push --all')}`));
      console.log('');
    }
  } catch { /* non-fatal */ }
}

export async function startCommand(args: string[] = []): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bex from inside the Forge project directory.');
    process.exit(1);
  }

  // Auto-init on first run
  if (!existsSync(resolve(root, '.env'))) {
    console.log(chalk.magenta('  First run detected — running bex init...'));
    const { initCommand } = await import('./init.js');
    await initCommand();
  }

  readEnv();

  // ── Single-service shortcuts ──────────────────────────────────────────────
  const target = args[0];
  if (target === 'dashboard') {
    const dashSpinner = ora('Rebuilding dashboard…').start();
    const result = spawnSync('npm', ['run', 'build', '--silent'], {
      cwd: resolve(root, 'apps/dashboard'),
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      dashSpinner.fail('Dashboard build failed');
      console.error(result.stderr);
      process.exit(1);
    }
    ensureDashboardBuilt(root);
    dashSpinner.succeed('Dashboard rebuilt');
    spawnSync('pm2', ['restart', 'bex-dashboard'], { stdio: 'inherit' });
    printSuccess('Dashboard restarted');
    return;
  }

  const serviceMap: Record<string, string> = {
    api: 'bex-api', registry: 'bex-registry', admin: 'bex-admin',
    worker: 'bex-worker', telegram: 'bex-telegram',
  };
  if (target && serviceMap[target]) {
    spawnSync('pm2', ['restart', serviceMap[target]], { stdio: 'inherit' });
    printSuccess(`${target} restarted`);
    return;
  }

  // ── Full startup ──────────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.bold.magenta('  BEX — Starting services…'));
  console.log('');

  const infraSpinner = ora('Starting infrastructure (postgres, redis)…').start();
  try {
    ensureInfraRunning(root);
    infraSpinner.succeed('Infrastructure ready');
  } catch {
    infraSpinner.warn('Could not start Docker infra — ensure postgres + redis are running');
  }
  await new Promise((r) => setTimeout(r, 1000));

  // Ensure dashboard is built before starting
  if (!existsSync(resolve(root, 'apps/dashboard/.next/standalone/apps/dashboard/server.js'))) {
    const dashSpinner = ora('Building dashboard (first time)…').start();
    const result = spawnSync('npm', ['run', 'build', '--silent'], {
      cwd: resolve(root, 'apps/dashboard'),
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      dashSpinner.fail('Dashboard build failed — check logs');
    } else {
      ensureDashboardBuilt(root);
      dashSpinner.succeed('Dashboard built');
    }
  } else {
    ensureDashboardBuilt(root);
  }

  const startSpinner = ora('Starting services via pm2…').start();
  startLocalServices(root);
  startSpinner.succeed('Services started');

  await new Promise((r) => setTimeout(r, 6000));

  // Health checks
  console.log('');
  const checks = [
    ['Skill Registry', 'http://localhost:5050/health'],
    ['API Gateway',    'http://localhost:4000/health'],
    ['Admin API',      'http://localhost:4001/health'],
    ['Dashboard',      'http://localhost:3000'],
  ] as const;

  let allOk = true;
  for (const [label, url] of checks) {
    const ok = await waitForService(url, label, 30_000);
    if (!ok) allOk = false;
  }

  console.log('');
  if (allOk) {
    printSuccess('Forge is running');
  } else {
    printWarning('Some services are still starting. Check: bex logs');
  }

  await checkRegistrySync(root);

  console.log('');
  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │') + chalk.magenta('  Dashboard     →  http://localhost:3000           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.magenta('  API Gateway   →  http://localhost:4000           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.magenta('  Admin API     →  http://localhost:4001           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.magenta('  Skill Registry→  http://localhost:5050           ') + chalk.bold('│'));
  console.log(chalk.bold('  ├──────────────────────────────────────────────────┤'));
  console.log(chalk.bold('  │') + chalk.dim('  Login:  use credentials set during bex init      ') + chalk.bold('│'));
  console.log(chalk.bold('  ├──────────────────────────────────────────────────┤'));
  console.log(chalk.bold('  │') + chalk.dim('  bex status   — service health                   ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.dim('  bex logs     — tail all logs                    ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.dim('  bex start dashboard  — rebuild + restart UI     ') + chalk.bold('│'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log('');
  process.exit(0);
}

