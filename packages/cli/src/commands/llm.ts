/**
 * bex llm <subcommand>
 *
 * Commands:
 *   bex llm list                — list configured LLM providers
 *   bex llm add                 — add a new LLM configuration
 *   bex llm use <name>          — set a named LLM config as default
 *   bex llm remove <name>       — remove an LLM configuration
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

async function listLlmConfigs(): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  const res = await fetch(`${apiUrl}/llm-configs`, { headers: headers(token) });
  const json = (await res.json()) as { data?: Array<{ id: string; name: string; provider: string; model: string; isDefault: boolean }> };
  const configs = json.data ?? [];

  if (configs.length === 0) {
    console.log(chalk.dim('No LLM configurations found. Run: bex llm add'));
    return;
  }

  console.log('');
  console.log(chalk.bold('LLM Configurations'));
  console.log(chalk.dim('─'.repeat(60)));
  for (const c of configs) {
    const badge = c.isDefault ? chalk.green(' [default]') : '';
    console.log(`  ${chalk.cyan(c.name)}${badge}`);
    console.log(`    Provider: ${c.provider}  Model: ${c.model}`);
  }
  console.log('');
}

async function addLlmConfig(): Promise<void> {
  const { input, select } = await import('@inquirer/prompts');
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  console.log(chalk.bold('\nAdd LLM Configuration\n'));

  const name = await input({ message: 'Configuration name (e.g. "OpenAI Production"):' });
  const provider = await select({
    message: 'Provider:',
    choices: [
      { name: 'OpenAI', value: 'openai' },
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'Azure OpenAI', value: 'azure-openai' },
    ],
  });

  const defaultModels: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-20241022',
    'azure-openai': 'gpt-4o',
  };
  const model = await input({
    message: `Model (default: ${defaultModels[provider] ?? 'gpt-4o'}):`,
    default: defaultModels[provider] ?? 'gpt-4o',
  });
  const apiKey = await input({ message: 'API Key:' });
  const isDefault = await select({
    message: 'Set as default?',
    choices: [{ name: 'Yes', value: true }, { name: 'No', value: false }],
  });

  const res = await fetch(`${apiUrl}/llm-configs`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name, provider, model, apiKey, isDefault }),
  });

  if (res.ok) {
    console.log(chalk.green(`\nLLM config "${name}" added successfully.`));
    if (isDefault) console.log(chalk.dim('Set as default LLM provider.'));
  } else {
    const err = (await res.json()) as { message?: string };
    console.error(chalk.red(`Failed to add LLM config: ${err.message ?? res.statusText}`));
  }
}

async function useLlmConfig(name: string): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  // Find the config by name
  const listRes = await fetch(`${apiUrl}/llm-configs`, { headers: headers(token) });
  const listJson = (await listRes.json()) as { data?: Array<{ id: string; name: string }> };
  const found = (listJson.data ?? []).find((c) => c.name.toLowerCase() === name.toLowerCase());

  if (!found) {
    console.error(chalk.red(`LLM config "${name}" not found. Run: bex llm list`));
    process.exit(1);
  }

  const res = await fetch(`${apiUrl}/llm-configs/${found.id}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ isDefault: true }),
  });

  if (res.ok) {
    console.log(chalk.green(`"${name}" is now the default LLM configuration.`));
  } else {
    console.error(chalk.red(`Failed to update: ${res.statusText}`));
  }
}

async function removeLlmConfig(name: string): Promise<void> {
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  const listRes = await fetch(`${apiUrl}/llm-configs`, { headers: headers(token) });
  const listJson = (await listRes.json()) as { data?: Array<{ id: string; name: string }> };
  const found = (listJson.data ?? []).find((c) => c.name.toLowerCase() === name.toLowerCase());

  if (!found) {
    console.error(chalk.red(`LLM config "${name}" not found.`));
    process.exit(1);
  }

  const res = await fetch(`${apiUrl}/llm-configs/${found.id}`, {
    method: 'DELETE',
    headers: headers(token),
  });

  if (res.status === 204) {
    console.log(chalk.green(`LLM config "${name}" removed.`));
  } else {
    console.error(chalk.red(`Failed to remove: ${res.statusText}`));
  }
}

export function buildLlmCommand(): Command {
  const cmd = new Command('llm').description('Manage LLM provider configurations');

  cmd
    .command('list')
    .description('List configured LLM providers')
    .action(listLlmConfigs);

  cmd
    .command('add')
    .description('Add a new LLM configuration')
    .action(addLlmConfig);

  cmd
    .command('use <name>')
    .description('Set a named LLM config as default')
    .action(useLlmConfig);

  cmd
    .command('remove <name>')
    .description('Remove an LLM configuration')
    .action(removeLlmConfig);

  return cmd;
}
