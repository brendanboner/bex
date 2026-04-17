import ora from 'ora';
import { findProjectRoot, composeCommand, printError } from '../utils.js';

export async function stopCommand(): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bforge from inside the Forge project directory.');
    process.exit(1);
  }

  const spinner = ora('Stopping Forge services...').start();
  const result = composeCommand(['down'], root);

  if (result.status !== 0) {
    spinner.fail('Failed to stop services gracefully.');
    process.exit(1);
  }

  spinner.succeed('All services stopped');
}
