import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, composeCommand, isDockerRunning, waitForService, printError, printSuccess } from '../utils.js';

export async function startCommand(options: { build?: boolean }): Promise<void> {
  if (!isDockerRunning()) {
    printError('Docker is not running. Please start Docker first.');
    process.exit(1);
  }

  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bforge from inside the Forge project directory.');
    process.exit(1);
  }

  console.log('');
  const spinner = ora('Starting Forge services...').start();

  const buildArgs = options.build !== false ? ['--build'] : [];
  const result = composeCommand(['up', '-d', ...buildArgs], root);

  if (result.status !== 0) {
    spinner.fail('Failed to start services. Run `bforge logs` for details.');
    process.exit(1);
  }

  spinner.succeed('Services started');
  console.log('');

  await waitForService('http://localhost:4000/health', 'API Gateway', 60_000);
  await waitForService('http://localhost:3000', 'Dashboard', 60_000);

  console.log('');
  console.log(chalk.bold('Forge is running'));
  console.log(chalk.dim('  Dashboard: http://localhost:3000'));
  console.log(chalk.dim('  API:       http://localhost:4000'));
  console.log('');
}
