/**
 * bex registry <subcommand>
 *
 * Commands:
 *   bex registry show           — show current registry URL
 *   bex registry set <url>      — set the registry URL
 *   bex registry test           — test connectivity to the configured registry
 */
import { Command } from 'commander';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import chalk from 'chalk';

function loadEnv(): Record<string, string> {
  try {
    const root = path.resolve(__dirname, '..', '..', '..', '..');
    const envPath = path.join(root, '.env');
    const raw = readFileSync(envPath, 'utf8');
    const env: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

function getEnvPath(): string {
  return path.resolve(__dirname, '..', '..', '..', '..', '.env');
}

function setEnvVar(key: string, value: string): void {
  const envPath = getEnvPath();
  try {
    let raw = readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(raw)) {
      raw = raw.replace(regex, `${key}=${value}`);
    } else {
      raw += `\n${key}=${value}\n`;
    }
    writeFileSync(envPath, raw, 'utf8');
  } catch {
    console.error(chalk.red(`Could not write to .env file at ${envPath}`));
  }
}

function getRegistryUrl(env: Record<string, string>): string {
  return env['SKILL_REGISTRY_URL'] ?? process.env['SKILL_REGISTRY_URL'] ?? '';
}

function getRegistryToken(env: Record<string, string>): string {
  return env['SKILL_REGISTRY_TOKEN'] ?? process.env['SKILL_REGISTRY_TOKEN'] ?? '';
}

function headers(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function showRegistry(): Promise<void> {
  const env = loadEnv();
  const url = env['SKILL_REGISTRY_URL'] ?? process.env['SKILL_REGISTRY_URL'] ?? '';
  if (url) {
    console.log(`\nRegistry URL: ${chalk.cyan(url)}\n`);
  } else {
    console.log(chalk.yellow('\nRegistry URL: not configured') + chalk.dim(' (set SKILL_REGISTRY_URL in .env)\n'));
  }
}

async function setRegistry(url: string, opts: { token?: string }): Promise<void> {
  setEnvVar('SKILL_REGISTRY_URL', url);
  if (opts.token) setEnvVar('SKILL_REGISTRY_TOKEN', opts.token);
  console.log(chalk.green(`\nRegistry URL set to: ${url}`));
  console.log(chalk.dim('Restart services to apply: bex restart'));
}

async function testRegistry(): Promise<void> {
  const env = loadEnv();
  const registryUrl = env['SKILL_REGISTRY_URL'] ?? process.env['SKILL_REGISTRY_URL'] ?? '';
  const token = env['SKILL_REGISTRY_TOKEN'] ?? process.env['SKILL_REGISTRY_TOKEN'] ?? '';
  const { fetch } = await import('undici');

  console.log(chalk.dim('\nTesting registry connectivity...'));

  if (!registryUrl) {
    console.log(chalk.yellow('\nNo registry URL configured. Set SKILL_REGISTRY_URL in .env\n'));
    return;
  }

  try {
    const hdrs = headers(token);
    let connected = false;
    let skillCount = 0;

    const healthRes = await fetch(`${registryUrl}/health`, { headers: hdrs }).catch(() => null);
    if (!healthRes?.ok) {
      console.log(chalk.red(`\nCould not connect to registry: ${registryUrl}\n`));
      return;
    }
    connected = true;

    const listRes = await fetch(`${registryUrl}/registry/skills`, { headers: hdrs }).catch(() => null);
    if (listRes?.ok) {
      const data = await listRes.json() as { data?: unknown[] };
      skillCount = data.data?.length ?? 0;
    }

    console.log(chalk.green(`\nConnected to registry: ${registryUrl}`));
    console.log(`Skills available: ${skillCount}`);

    // Probe write auth by checking /registry/info (public) then attempting a no-op publish
    if (token) {
      const infoRes = await fetch(`${registryUrl}/registry/info`, { headers: hdrs }).catch(() => null);
      const infoJson = infoRes?.ok ? (await infoRes.json() as { data?: { authRequired?: boolean } }) : null;
      const authRequired = infoJson?.data?.authRequired ?? true;

      if (!authRequired) {
        console.log(chalk.dim('Write auth: not required (open registry)'));
      } else {
        // Send an intentionally invalid body — auth is checked before validation,
        // so 400 (bad request) means auth passed; 401 means token rejected.
        const probeRes = await fetch(`${registryUrl}/registry/publish`, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({}),
        }).catch(() => null);

        if (probeRes?.status === 401) {
          console.log(chalk.red('Write auth: ❌ token rejected (SKILL_REGISTRY_TOKEN does not match registry)'));
          console.log(chalk.dim('  Update SKILL_REGISTRY_TOKEN in .env to match the registry\'s REGISTRY_AUTH_TOKEN'));
        } else {
          // 400 (validation error), 201, 409 — all mean auth passed
          console.log(chalk.green('Write auth: ✓ token accepted'));
          if (skillCount === 0) console.log(chalk.dim('  Registry is empty — run: bex skill push --all'));
        }
      }
    } else {
      console.log(chalk.dim('Write auth: no token set (SKILL_REGISTRY_TOKEN not configured)'));
    }
    console.log('');
  } catch (err) {
    console.error(chalk.red(`Connection failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

export function buildRegistryCommand(): Command {
  const cmd = new Command('registry').description('Manage skill registry configuration');

  cmd
    .command('show')
    .description('Show current registry URL')
    .action(showRegistry);

  cmd
    .command('set <url>')
    .description('Set the registry URL (e.g. https://skills.octorapidlabs.com)')
    .option('--token <token>', 'Registry auth token')
    .action(setRegistry);

  cmd
    .command('test')
    .description('Test connectivity to the configured registry')
    .action(testRegistry);

  return cmd;
}
