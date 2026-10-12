import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ora from 'ora';
import { findProjectRoot, printError, printSuccess } from '../utils.js';

export async function restartCommand(): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bex from inside the Forge project directory.');
    process.exit(1);
  }

  console.log('');

  // Build all packages before restarting so services always run the latest code.
  const buildSpinner = ora('Building packages…').start();
  const buildResult = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
  if (buildResult.status !== 0) {
    buildSpinner.fail('Build failed — aborting restart');
    const stderr = buildResult.stderr?.toString().trim();
    if (stderr) console.error(stderr);
    process.exit(1);
  }
  buildSpinner.succeed('Build complete');

  const spinner = ora('Restarting Forge services…').start();
  const eco = resolve(root, 'ecosystem.config.cjs');
  spawnSync('pm2', ['restart', eco], { stdio: 'pipe' });
  spinner.succeed('All services restarted');
  printSuccess('Services are back up. Check health with: bex status');
  console.log('');
}
