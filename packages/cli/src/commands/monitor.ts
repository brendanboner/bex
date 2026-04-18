import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { findProjectRoot, printError, printSuccess } from '../utils.js';

const SESSION = 'forge';

function tmuxAvailable(): boolean {
  try {
    execSync('which tmux', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function sessionExists(): boolean {
  try {
    execSync(`tmux has-session -t "${SESSION}" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function monitorCommand(options: { attach?: boolean; stop?: boolean }): Promise<void> {
  let root: string;
  try {
    root = findProjectRoot();
  } catch {
    printError('Run bforge from inside the Forge project directory.');
    process.exit(1);
  }

  // ── bforge monitor stop ───────────────────────────────────────────────────
  if (options.stop) {
    const { stopLocalServices } = await import('../utils.js');
    stopLocalServices();
    if (sessionExists()) {
      execSync(`tmux kill-session -t "${SESSION}"`, { stdio: 'pipe' });
      printSuccess('tmux session "forge" closed');
    }
    printSuccess('All Forge services stopped');
    return;
  }

  // ── bforge monitor attach ─────────────────────────────────────────────────
  if (options.attach) {
    if (!sessionExists()) {
      printError('No forge tmux session running. Run `bforge monitor` first.');
      process.exit(1);
    }
    spawnSync('tmux', ['attach-session', '-t', SESSION], { stdio: 'inherit' });
    return;
  }

  // ── tmux requirement check ────────────────────────────────────────────────
  if (!tmuxAvailable()) {
    console.log('');
    console.log(chalk.red('  ✗ tmux is required for bforge monitor'));
    console.log('');
    console.log(chalk.bold('  Install tmux:'));
    console.log(chalk.dim('    macOS:   brew install tmux'));
    console.log(chalk.dim('    Ubuntu:  sudo apt install tmux'));
    console.log(chalk.dim('    RHEL:    sudo yum install tmux'));
    console.log('');
    console.log(chalk.dim('  Alternatively, use `bforge start` to run services without a monitor view.'));
    console.log('');
    process.exit(1);
  }

  const logsDir = resolve(root, 'logs');

  // Ensure log dir and files exist so tail -f works even before services start
  mkdirSync(logsDir, { recursive: true });
  const logs = {
    api:      resolve(logsDir, 'api-gateway.log'),
    registry: resolve(logsDir, 'skill-registry.log'),
    admin:    resolve(logsDir, 'admin-api.log'),
    worker:   resolve(logsDir, 'worker.log'),
    dashboard:resolve(logsDir, 'dashboard.log'),
    telegram: resolve(logsDir, 'telegram-bot.log'),
  };
  for (const f of Object.values(logs)) {
    if (!existsSync(f)) writeFileSync(f, '');
  }

  // Kill stale session if present
  if (sessionExists()) {
    execSync(`tmux kill-session -t "${SESSION}"`, { stdio: 'pipe' });
  }

  console.log('');
  console.log(chalk.cyan('  Opening tmux monitor session...'));
  console.log(chalk.dim('  Detach any time with Ctrl+B, D'));
  console.log('');

  const run = (cmd: string) => execSync(cmd, { stdio: 'pipe' });

  // Window "services" — 4-pane grid: api | registry / admin | worker
  // Use simple session-only targeting (no :window.pane) for broad tmux compatibility
  run(`tmux new-session -d -s "${SESSION}" -n services`);

  // Pane 0 (top-left): API Gateway
  run(`tmux send-keys -t "${SESSION}" "tail -n 50 -f '${logs.api}'" Enter`);

  // Pane 1 (top-right): Skill Registry — split right
  run(`tmux split-window -h -t "${SESSION}"`);
  run(`tmux send-keys -t "${SESSION}" "tail -n 50 -f '${logs.registry}'" Enter`);

  // Pane 2 (bottom-right): Worker — split below current (top-right)
  run(`tmux split-window -v -t "${SESSION}"`);
  run(`tmux send-keys -t "${SESSION}" "tail -n 50 -f '${logs.worker}'" Enter`);

  // Pane 3 (bottom-left): Admin API — move left to top-left pane, split below
  run(`tmux select-pane -L`);
  run(`tmux split-window -v -t "${SESSION}"`);
  run(`tmux send-keys -t "${SESSION}" "tail -n 50 -f '${logs.admin}'" Enter`);

  // Window "bots" — Dashboard | Telegram side by side
  run(`tmux new-window -t "${SESSION}" -n bots`);
  run(`tmux send-keys -t "${SESSION}" "tail -n 50 -f '${logs.dashboard}'" Enter`);
  run(`tmux split-window -h -t "${SESSION}"`);
  run(`tmux send-keys -t "${SESSION}" "tail -n 50 -f '${logs.telegram}'" Enter`);

  // Return focus to services window
  run(`tmux select-window -t "${SESSION}:services"`);

  spawnSync('tmux', ['attach-session', '-t', SESSION], { stdio: 'inherit' });
}

