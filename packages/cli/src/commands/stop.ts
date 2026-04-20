import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, stopLocalServices, printError, printSuccess } from '../utils.js';

export async function stopCommand(): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bex from inside the Forge project directory.');
    process.exit(1);
  }

  console.log('');
  const spinner = ora('Stopping Forge services...').start();
  stopLocalServices();
  await new Promise((r) => setTimeout(r, 1000));
  spinner.succeed('All local services stopped');

  // Also stop docker infra if running
  try {
    const { execSync } = await import('node:child_process');
    const { resolve } = await import('node:path');
    execSync(
      `docker compose -f "${resolve(root, 'infra/docker-compose.yml')}" stop postgres redis 2>/dev/null || true`,
      { stdio: 'pipe' }
    );
    printSuccess('Docker infrastructure stopped');
  } catch {
    // Docker may not be running — fine
  }
  console.log('');
}

