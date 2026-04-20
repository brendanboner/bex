import { existsSync } from 'node:fs';
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
    spawnSync('pm2', ['restart', 'forge-dashboard'], { stdio: 'inherit' });
    printSuccess('Dashboard restarted');
    return;
  }

  const serviceMap: Record<string, string> = {
    api: 'forge-api', registry: 'forge-registry', admin: 'forge-admin',
    worker: 'forge-worker', telegram: 'forge-telegram',
  };
  if (target && serviceMap[target]) {
    spawnSync('pm2', ['restart', serviceMap[target]], { stdio: 'inherit' });
    printSuccess(`${target} restarted`);
    return;
  }

  // ── Full startup ──────────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.bold.magenta('  Forge — Starting services…'));
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

  console.log('');
  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │') + chalk.magenta('  Dashboard     →  http://localhost:3000           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.magenta('  API Gateway   →  http://localhost:4000           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.magenta('  Admin API     →  http://localhost:4001           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.magenta('  Skill Registry→  http://localhost:5050           ') + chalk.bold('│'));
  console.log(chalk.bold('  ├──────────────────────────────────────────────────┤'));
  console.log(chalk.bold('  │') + chalk.dim('  Login:  admin@bex.local  /  bex-admin-2026       ') + chalk.bold('│'));
  console.log(chalk.bold('  ├──────────────────────────────────────────────────┤'));
  console.log(chalk.bold('  │') + chalk.dim('  bex status   — service health                   ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.dim('  bex logs     — tail all logs                    ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.dim('  bex start dashboard  — rebuild + restart UI     ') + chalk.bold('│'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log('');
}

