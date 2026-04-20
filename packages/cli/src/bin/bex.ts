#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../commands/init.js';
import { startCommand } from '../commands/start.js';
import { stopCommand } from '../commands/stop.js';
import { statusCommand } from '../commands/status.js';
import { logsCommand } from '../commands/logs.js';
import { monitorCommand } from '../commands/monitor.js';
import { buildSkillCommand } from '../commands/skill.js';
import { buildLlmCommand } from '../commands/llm.js';
import { buildCredentialCommand } from '../commands/credential.js';
import { buildRegistryCommand } from '../commands/registry.js';

const program = new Command();

program
  .name('bex')
  .description('BEX — Brendan\'s Extreme eXchange')
  .version('0.1.0');

program
  .command('init')
  .description('First-run setup wizard: configure LLM, channel, and admin account')
  .action(initCommand);

program
  .command('start [target]')
  .description('Start all services, or restart one: dashboard|api|worker|telegram|registry')
  .action((target?: string) => startCommand(target ? [target] : []));

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
  .description('Tail service logs (omit service to tail all). Services: api, registry, admin, worker, dashboard')
  .option('-n, --lines <number>', 'Number of log lines to show', '50')
  .action(logsCommand);

program
  .command('monitor')
  .description('Start services and open a tmux monitor session with live log tailing (requires tmux)')
  .option('--attach', 'Attach to an existing monitor session')
  .option('--stop', 'Stop all services and close the monitor session')
  .action(monitorCommand);

program.addCommand(buildSkillCommand());
program.addCommand(buildLlmCommand());
program.addCommand(buildCredentialCommand());
program.addCommand(buildRegistryCommand());

program.parse();

