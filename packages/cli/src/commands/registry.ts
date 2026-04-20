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

function getApiUrl(env: Record<string, string>): string {
  return env['API_GATEWAY_URL'] ?? process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
}

function getAdminToken(env: Record<string, string>): string {
  return env['ADMIN_TOKEN'] ?? process.env['ADMIN_TOKEN'] ?? 'dev-admin-secret';
}

function headers(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function showRegistry(): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  try {
    const res = await fetch(`${apiUrl}/registry/config`, { headers: headers(token) });
    const json = (await res.json()) as { data?: { url: string; isDefault: boolean } };
    const cfg = json.data;
    const isDefault = cfg?.isDefault ? chalk.dim(' (default)') : '';
    console.log(`\nRegistry URL: ${chalk.cyan(cfg?.url ?? 'not configured')}${isDefault}\n`);
  } catch {
    console.error(chalk.red('Could not connect to API gateway. Is BEX running?'));
  }
}

async function setRegistry(url: string, opts: { token?: string }): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const adminToken = getAdminToken(env);
  const { fetch } = await import('undici');

  // Update the .env file
  setEnvVar('SKILL_REGISTRY_URL', url);
  if (opts.token) setEnvVar('SKILL_REGISTRY_TOKEN', opts.token);

  // Also tell the running API gateway
  try {
    const body: Record<string, string> = { url };
    if (opts.token) body.authToken = opts.token;
    await fetch(`${apiUrl}/registry/config`, {
      method: 'PUT',
      headers: headers(adminToken),
      body: JSON.stringify(body),
    });
  } catch {
    // Non-fatal: .env already updated
  }

  console.log(chalk.green(`\nRegistry URL set to: ${url}`));
  console.log(chalk.dim('Restart services to apply: bex stop && bex start'));
}

async function testRegistry(): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  console.log(chalk.dim('\nTesting registry connectivity...'));

  try {
    const res = await fetch(`${apiUrl}/registry/config/test`, {
      method: 'POST',
      headers: headers(token),
    });
    const json = (await res.json()) as { data?: { connected: boolean; url: string; skillCount?: number; error?: string } };
    const result = json.data;

    if (result?.connected) {
      console.log(chalk.green(`\nConnected to registry: ${result.url}`));
      console.log(`Skills available: ${result.skillCount ?? 0}\n`);
    } else {
      console.log(chalk.red(`\nCould not connect to registry: ${result?.url}`));
      if (result?.error) console.log(chalk.dim(`Error: ${result.error}`));
      console.log('');
    }
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
