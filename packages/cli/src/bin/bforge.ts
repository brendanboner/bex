#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../commands/init.js';
import { startCommand } from '../commands/start.js';
import { stopCommand } from '../commands/stop.js';
import { statusCommand } from '../commands/status.js';
import { logsCommand } from '../commands/logs.js';

const program = new Command();

program
  .name('bforge')
  .description('Forge — Enterprise Agentic Platform')
  .version('0.1.0');

program
  .command('init')
  .description('First-run setup wizard: configure LLM, channel, and admin account')
  .action(initCommand);

program
  .command('start')
  .description('Start all platform services')
  .option('--no-build', 'Skip Docker image builds')
  .action(startCommand);

program
  .command('stop')
  .description('Stop all platform services')
  .action(stopCommand);

program
  .command('status')
  .description('Show health status of all services')
  .action(statusCommand);

program
  .command('logs [service]')
  .description('Tail service logs (omit service to tail all)')
  .option('-n, --lines <number>', 'Number of log lines to show', '50')
  .action(logsCommand);

program.parse();
