import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findProjectRoot, printError, printWarning } from '../utils.js';

const LOG_ALIASES: Record<string, string> = {
  api: 'api-gateway',
  gateway: 'api-gateway',
  registry: 'skill-registry',
  'skill-registry': 'skill-registry',
  admin: 'admin-api',
  dashboard: 'dashboard',
  worker: 'worker',
};

const ALL_LOGS = ['api-gateway', 'skill-registry', 'admin-api', 'worker', 'dashboard'];

export async function logsCommand(service: string | undefined, options: { lines: string }): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bex from inside the Forge project directory.');
    process.exit(1);
  }

  const logsDir = resolve(root, 'logs');
  const tail = options.lines ?? '50';

  if (service) {
    const resolved = LOG_ALIASES[service] ?? service;
    const logFile = resolve(logsDir, `${resolved}.log`);
    if (!existsSync(logFile)) {
      printWarning(`No log file found for "${resolved}". Has bex start been run?`);
      printError(`Expected: ${logFile}`);
      process.exit(1);
    }
    spawnSync('tail', ['-n', tail, '-f', logFile], { stdio: 'inherit' });
  } else {
    // Tail all log files that exist
    const files = ALL_LOGS
      .map((name) => resolve(logsDir, `${name}.log`))
      .filter(existsSync);

    if (files.length === 0) {
      printWarning('No log files found. Has bex start been run?');
      process.exit(1);
    }

    spawnSync('tail', ['-n', tail, '-f', ...files], { stdio: 'inherit' });
  }
}

