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
  const { input, select, password } = await import('@inquirer/prompts');
  const env = loadEnv();
  const apiUrl = getApiUrl(env);
  const token = getAdminToken(env);
  const { fetch } = await import('undici');

  console.log(chalk.bold('\nAdd LLM Configuration\n'));

  const AZURE_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-35-turbo', 'gpt-4'];
  const DEFAULT_MODELS: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    'azure-openai': AZURE_MODELS,
    ollama: ['llama3.2', 'llama3.1', 'mistral', 'gemma2', 'phi3', 'qwen2.5'],
  };

  const name = await input({ message: 'Configuration name (e.g. "Azure Production"):' });
  const provider = await select({
    message: 'Provider:',
    choices: [
      { name: 'OpenAI', value: 'openai' },
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'Azure OpenAI', value: 'azure-openai' },
      { name: 'Ollama (remote/local)', value: 'ollama' },
    ],
  });

  const modelChoices = (DEFAULT_MODELS[provider] ?? ['gpt-4o']).map((m) => ({ name: m, value: m }));
  const model = await select({
    message: `Deployment / model:`,
    choices: modelChoices,
  });

  let baseUrl: string | undefined;
  let endpoint: string | undefined;
  let apiVersion: string | undefined;
  let apiKey: string | undefined;

  if (provider === 'ollama') {
    baseUrl = await input({
      message: 'Ollama base URL (e.g. http://192.168.1.10:11434):',
      default: 'http://localhost:11434',
    });
  } else if (provider === 'azure-openai') {
    endpoint = await input({
      message: 'Azure endpoint URL (e.g. https://my-resource.openai.azure.com/):',
      validate: (v: string) => (v.startsWith('https://') && v.includes('.openai.azure.com')) || 'Enter a valid Azure endpoint',
    });
    apiVersion = await input({
      message: 'API version:',
      default: '2024-08-01-preview',
    });
    apiKey = await password({ message: 'Azure API key:' });
  } else {
    apiKey = await password({ message: 'API Key:' });
  }

  const isDefault = await select({
    message: 'Set as default?',
    choices: [{ name: 'Yes', value: true }, { name: 'No', value: false }],
  });

  const res = await fetch(`${apiUrl}/llm-configs`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name, provider, model, apiKey, baseUrl, endpoint, apiVersion, isDefault }),
  });

  if (res.ok) {
    console.log(chalk.green(`\nLLM config "${name}" added successfully.`));
    if (isDefault) console.log(chalk.dim('Set as default LLM provider.'));
  } else {
    const err = (await res.json()) as { message?: string; error?: { message?: string } };
    const msg = (err as { error?: { message?: string } }).error?.message ?? (err as { message?: string }).message ?? res.statusText;
    console.error(chalk.red(`Failed to add LLM config: ${msg}`));
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
