/**
 * bex credential <subcommand>
 *
 * Commands:
 *   bex credential list             — list all credentials
 *   bex credential add              — add a new credential interactively
 *   bex credential remove <name>    — remove a credential by name
 */
import { Command } from 'commander';
import path from 'path';
import { readFileSync } from 'fs';
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

function getApiUrl(env: Record<string, string>): string {
  return env['API_GATEWAY_URL'] ?? process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
}

function getAdminToken(env: Record<string, string>): string {
  return env['ADMIN_TOKEN'] ?? process.env['ADMIN_TOKEN'] ?? 'dev-admin-secret';
}

function headers(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function listCredentials(): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  const res = await fetch(`${apiUrl}/credentials`, { headers: headers(token) });
  const json = (await res.json()) as { data?: Array<{ id: string; name: string; credentialType: string; scope: string; description?: string }> };
  const creds = json.data ?? [];

  if (creds.length === 0) {
    console.log(chalk.dim('No credentials configured. Run: bex credential add'));
    return;
  }

  console.log('');
  console.log(chalk.bold('Credentials'));
  console.log(chalk.dim('─'.repeat(60)));
  for (const c of creds) {
    console.log(`  ${chalk.cyan(c.name)}  ${chalk.dim(c.credentialType)}  ${chalk.dim(c.scope)}`);
    if (c.description) console.log(`    ${chalk.dim(c.description)}`);
  }
  console.log('');
}

async function addCredential(): Promise<void> {
  const { input, select } = await import('@inquirer/prompts');
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  console.log(chalk.bold('\nAdd Credential\n'));

  const name = await input({ message: 'Credential name (e.g. "xco-admin"):' });
  const description = await input({ message: 'Description (optional):' });
  const credentialType = await select({
    message: 'Type:',
    choices: [
      { name: 'API Token', value: 'API_TOKEN' },
      { name: 'Username / Password', value: 'USERNAME_PASSWORD' },
      { name: 'SSH Key', value: 'SSH_KEY' },
      { name: 'Bearer Token', value: 'BEARER_TOKEN' },
      { name: 'Certificate', value: 'CERTIFICATE' },
    ],
  });
  const scope = await select({
    message: 'Scope:',
    choices: [
      { name: 'Global (available to all agents)', value: 'GLOBAL' },
      { name: 'Personal (only for your user)', value: 'PERSONAL' },
    ],
  });

  let value: Record<string, string> = {};
  if (credentialType === 'API_TOKEN') {
    const apiKey = await input({ message: 'API Key / Token:' });
    value = { apiKey };
  } else if (credentialType === 'USERNAME_PASSWORD') {
    const username = await input({ message: 'Username:' });
    const password = await input({ message: 'Password:' });
    value = { username, password };
  } else if (credentialType === 'BEARER_TOKEN') {
    const token2 = await input({ message: 'Bearer Token:' });
    value = { token: token2 };
  } else if (credentialType === 'SSH_KEY') {
    const privateKey = await input({ message: 'Private Key (paste, then press Enter):' });
    const passphrase = await input({ message: 'Passphrase (leave blank if none):' });
    value = { privateKey, ...(passphrase ? { passphrase } : {}) };
  } else {
    const raw = await input({ message: 'Value (JSON or plain text):' });
    try { value = JSON.parse(raw); } catch { value = { value: raw }; }
  }

  const body = { name, description: description || undefined, credentialType, scope, value };
  const res = await fetch(`${apiUrl}/credentials`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });

  if (res.ok) {
    console.log(chalk.green(`\nCredential "${name}" added successfully.`));
  } else {
    const errJson = (await res.json()) as { message?: string };
    console.error(chalk.red(`Failed to add credential: ${errJson.message ?? res.statusText}`));
  }
}

async function removeCredential(name: string): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  const listRes = await fetch(`${apiUrl}/credentials`, { headers: headers(token) });
  const listJson = (await listRes.json()) as { data?: Array<{ id: string; name: string }> };
  const found = (listJson.data ?? []).find((c) => c.name.toLowerCase() === name.toLowerCase());

  if (!found) {
    console.error(chalk.red(`Credential "${name}" not found. Run: bex credential list`));
    process.exit(1);
  }

  const res = await fetch(`${apiUrl}/credentials/${found.id}`, {
    method: 'DELETE',
    headers: headers(token),
  });

  if (res.status === 204) {
    console.log(chalk.green(`Credential "${name}" removed.`));
  } else {
    console.error(chalk.red(`Failed to remove: ${res.statusText}`));
  }
}

export function buildCredentialCommand(): Command {
  const cmd = new Command('credential').description('Manage credentials');

  cmd
    .command('list')
    .description('List all configured credentials')
    .action(listCredentials);

  cmd
    .command('add')
    .description('Add a new credential interactively')
    .action(addCredential);

  cmd
    .command('remove <name>')
    .description('Remove a credential by name')
    .action(removeCredential);

  return cmd;
}
