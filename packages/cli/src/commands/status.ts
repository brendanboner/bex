import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { findProjectRoot, printError } from '../utils.js';

interface ServiceStatus {
  name: string;
  url?: string;
  healthy: boolean;
  responseTimeMs?: number;
  error?: string;
}

async function checkService(name: string, url: string): Promise<ServiceStatus> {
  const { default: fetch } = await import('node-fetch');
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return {
      name,
      url,
      healthy: res.ok,
      responseTimeMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name,
      url,
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function statusCommand(): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bex from inside the Forge project directory.');
    process.exit(1);
  }

  const spinner = ora('Checking service status...').start();

  const checks = await Promise.all([
    checkService('Skill Registry', 'http://localhost:5050/health'),
    checkService('API Gateway', 'http://localhost:4000/health'),
    checkService('Admin API', 'http://localhost:4001/health'),
    checkService('Dashboard', 'http://localhost:3000'),
  ]);

  spinner.stop();

  console.log('');
  console.log(chalk.bold('  Forge Service Status'));
  console.log(chalk.dim('  ' + '─'.repeat(52)));

  for (const svc of checks) {
    const icon = svc.healthy ? chalk.green('●') : chalk.red('●');
    const label = svc.healthy ? chalk.green('healthy') : chalk.red('unreachable');
    const timing = svc.responseTimeMs !== undefined ? chalk.dim(` (${svc.responseTimeMs}ms)`) : '';
    const url = svc.url ? chalk.dim(` ${svc.url}`) : '';
    console.log(`  ${icon} ${svc.name.padEnd(20)} ${label}${timing}${url}`);
    if (svc.error && !svc.healthy) {
      console.log(`    ${chalk.dim(svc.error)}`);
    }
  }

  // Show log files status
  const logsDir = resolve(root, 'logs');
  if (existsSync(logsDir)) {
    console.log('');
    console.log(chalk.bold('  Log Files'));
    console.log(chalk.dim('  ' + '─'.repeat(52)));
    const logs = ['api-gateway', 'skill-registry', 'admin-api', 'worker', 'dashboard'];
    for (const name of logs) {
      const file = resolve(logsDir, `${name}.log`);
      const exists = existsSync(file);
      const icon = exists ? chalk.green('●') : chalk.dim('○');
      const hint = exists ? chalk.dim(`  bex logs ${name}`) : chalk.dim('  (not started)');
      console.log(`  ${icon} ${name.padEnd(20)}${hint}`);
    }
  }
  console.log('');
}

