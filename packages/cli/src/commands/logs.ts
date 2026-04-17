import { findProjectRoot, composeCommand, printError } from '../utils.js';

const SERVICE_ALIASES: Record<string, string> = {
  api: 'api-gateway',
  gateway: 'api-gateway',
  dashboard: 'dashboard',
  db: 'postgres',
  postgres: 'postgres',
  redis: 'redis',
  scheduler: 'scheduler',
  dash: 'dashboard',
};

export async function logsCommand(service: string | undefined, options: { lines: string }): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bforge from inside the Forge project directory.');
    process.exit(1);
  }

  const tail = options.lines ?? '50';
  const resolved = service ? (SERVICE_ALIASES[service] ?? service) : undefined;

  const args = ['logs', '--follow', `--tail=${tail}`];
  if (resolved) args.push(resolved);

  composeCommand(args, root);
}
