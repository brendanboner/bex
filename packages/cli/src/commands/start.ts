import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import {
  findProjectRoot,
  readEnv,
  printError,
  printSuccess,
  printWarning,
  waitForService,
  stopLocalServices,
  getServiceDefs,
  ensureInfraRunning,
} from '../utils.js';

export async function startCommand(): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bex from inside the Forge project directory.');
    process.exit(1);
  }

  // Auto-init on first run
  if (!existsSync(resolve(root, '.env'))) {
    console.log(chalk.cyan('  First run detected — running bex init...'));
    console.log('');
    try {
      execSync(`bash "${resolve(root, 'init.sh')}"`, { stdio: 'inherit', cwd: root });
    } catch {
      printError('Init failed. Run `bex init` manually to configure.');
      process.exit(1);
    }
  }

  const env = readEnv();

  console.log('');
  console.log(chalk.bold.cyan('  Forge — Starting services...'));
  console.log('');

  // Start postgres + redis via docker if available
  const infraSpinner = ora('Starting infrastructure (postgres, redis)...').start();
  try {
    ensureInfraRunning(root);
    infraSpinner.succeed('Infrastructure ready');
  } catch {
    infraSpinner.warn('Could not start Docker infra — ensure postgres + redis are running');
  }
  await new Promise((r) => setTimeout(r, 2000));

  // Stop any existing processes
  stopLocalServices();
  await new Promise((r) => setTimeout(r, 500));

  // Start all services
  const defs = getServiceDefs(root, env);
  for (const svc of defs) {
    const spin = ora(`Starting ${svc.name}${svc.port ? ` (port ${svc.port})` : ''}...`).start();
    const pid = svc.start();
    if (pid) {
      spin.succeed(`${svc.name} started (PID ${pid})`);
    } else {
      spin.warn(`${svc.name} — could not get PID (may still be running)`);
    }
  }

  console.log('');
  const waitSpinner = ora('Waiting for services to be ready...').start();
  waitSpinner.stop();
  await new Promise((r) => setTimeout(r, 8000));

  // Health checks
  console.log('');
  const checks = [
    ['Skill Registry', 'http://localhost:5050/health'],
    ['API Gateway', 'http://localhost:4000/health'],
    ['Admin API', 'http://localhost:4001/health'],
    ['Dashboard', 'http://localhost:3000'],
  ] as const;

  let allOk = true;
  for (const [label, url] of checks) {
    const ok = await waitForService(url, label, 30_000);
    if (!ok) allOk = false;
  }

  console.log('');
  if (allOk) {
    console.log(chalk.bold.green('  ✓ Forge is running'));
  } else {
    printWarning('Some services are still starting. Check logs with: bex logs');
  }
  console.log('');
  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │') + chalk.cyan('  Dashboard     →  http://localhost:3000           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.cyan('  API Gateway   →  http://localhost:4000           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.cyan('  Admin API     →  http://localhost:4001           ') + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.cyan('  Skill Registry→  http://localhost:5050           ') + chalk.bold('│'));
  console.log(chalk.bold('  ├──────────────────────────────────────────────────┤'));
  console.log(chalk.bold('  │') + chalk.dim('  Login:  admin@forge.local  /  Forge2024!         ') + chalk.bold('│'));
  console.log(chalk.bold('  ├──────────────────────────────────────────────────┤'));
  console.log(chalk.bold('  │') + chalk.dim('  Logs:   bex logs [service]                    ') + chalk.bold('│'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log('');
}

