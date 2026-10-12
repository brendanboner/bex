import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ora from 'ora';
import { findProjectRoot, printError, printSuccess } from '../utils.js';

export async function stopCommand(): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bex from inside the Forge project directory.');
    process.exit(1);
  }

  console.log('');
  const spinner = ora('Stopping Forge services…').start();
  spawnSync('pm2', ['stop', resolve(root, 'ecosystem.config.cjs')], { stdio: 'pipe' });
  spinner.succeed('All services stopped');
  printSuccess('Run `bex start` to bring them back up');
  console.log('');
}

