import { input, password, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  printBanner, printSuccess, printError, printWarning,
  findProjectRoot, readEnv, writeEnv, waitForService,
  isDockerRunning, ensureInfraRunning, waitForPostgres, ensureDashboardBuilt, startLocalServices,
  restartService,
} from '../utils.js';

const LLM_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  azure: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-35-turbo', 'gpt-4'],
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'gemma2', 'phi3', 'qwen2.5'],
};

async function validateLlmKey(provider: string, apiKey: string): Promise<boolean> {
  const spinner = ora('Validating API key...').start();
  try {
    const { default: fetch } = await import('node-fetch');
    let url: string;
    let headers: Record<string, string>;

    if (provider === 'openai') {
      url = 'https://api.openai.com/v1/models';
      headers = { Authorization: `Bearer ${apiKey}` };
    } else if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/models';
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    } else if (provider === 'ollama') {
      spinner.info('Ollama — no API key required');
      return true;
    } else {
      spinner.info('Azure validation skipped — configure endpoint manually');
      return true;
    }

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      spinner.succeed('API key validated');
      return true;
    } else {
      spinner.fail(`Invalid API key (HTTP ${res.status})`);
      return false;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.warn(`Could not validate (${message}) — continuing anyway`);
    return true;
  }
}

export async function initCommand(): Promise<void> {
  printBanner();

  // Check if already initialised
  let prev: Record<string, string> = {};
  try {
    const root = findProjectRoot();
    const envPath = `${root}/.env`;
    if (existsSync(envPath)) {
      prev = readEnv();
      const overwrite = await confirm({
        message: chalk.yellow('.env already exists. Overwrite and re-configure?'),
        default: false,
      });
      if (!overwrite) {
        console.log('\n' + chalk.dim('Run `bex start` to start the platform.'));
        return;
      }
      console.log(chalk.dim('  Previously saved values shown as defaults — press Enter to keep them.\n'));
    }
  } catch {
    printError('Could not locate project root. Run bex from inside the Forge directory.');
    process.exit(1);
  }

  const root = findProjectRoot();

  // Helper: appends a dim hint showing the current value (or "set" for secrets)
  const hasKey = (key: string) => !!prev[key];
  const hint = (key: string) => prev[key] ? chalk.dim(` [current: ${prev[key]}]`) : '';
  const hintSecret = (key: string) => prev[key] ? chalk.dim(` [currently set — Enter to keep]`) : '';

  // ── Step 1: LLM ─────────────────────────────────────────────────────────
  console.log(chalk.bold('Step 1 of 5 — LLM Provider\n'));

  const prevProvider = prev['LLM_PROVIDER'] as string | undefined;
  const llmProvider = await select({
    message: `LLM provider:${hint('LLM_PROVIDER')}`,
    choices: [
      { name: `OpenAI (GPT-4o)${prevProvider === 'openai' ? ' ✓' : ''}`, value: 'openai' },
      { name: `Anthropic (Claude)${prevProvider === 'anthropic' ? ' ✓' : ''}`, value: 'anthropic' },
      { name: `Ollama (local, no API key)${prevProvider === 'ollama' ? ' ✓' : ''}`, value: 'ollama' },
      { name: `Azure OpenAI${prevProvider === 'azure' ? ' ✓' : ''}`, value: 'azure' },
    ],
    default: prevProvider ?? 'openai',
  });

  let llmApiKey = '';
  let ollamaBaseUrl = '';
  let azureEndpoint = '';
  let azureApiVersion = '';

  if (llmProvider === 'ollama') {
    ollamaBaseUrl = await input({
      message: `Ollama base URL:${hint('OLLAMA_BASE_URL')}`,
      default: prev['OLLAMA_BASE_URL'] || 'http://localhost:11434',
    });
    console.log(chalk.dim('  Make sure Ollama is running and the model is pulled (e.g. ollama pull llama3.2)'));
  } else if (llmProvider === 'azure') {
    // Azure requires endpoint + API key (+ optional API version)
    azureEndpoint = await input({
      message: `Azure OpenAI endpoint:${hint('AZURE_OPENAI_ENDPOINT')}`,
      default: prev['AZURE_OPENAI_ENDPOINT'] ?? '',
      validate: (v: string) => (v.startsWith('https://') && (v.includes('.openai.azure.com') || v.includes('.cognitiveservices.azure.com'))) || 'Enter a valid Azure endpoint (e.g. https://my-resource.openai.azure.com/ or https://my-resource.cognitiveservices.azure.com/)',
    });
    azureApiVersion = await input({
      message: `Azure API version:${hint('AZURE_OPENAI_API_VERSION')}`,
      default: prev['AZURE_OPENAI_API_VERSION'] || '2024-08-01-preview',
    });
    const apiKeyVar = 'AZURE_OPENAI_API_KEY';
    if (hasKey(apiKeyVar)) {
      const change = await confirm({ message: `Azure API key${hintSecret(apiKeyVar)} — change it?`, default: false });
      if (change) {
        llmApiKey = await password({ message: 'Azure OpenAI API key:' });
      } else {
        llmApiKey = prev[apiKeyVar] ?? '';
      }
    } else {
      llmApiKey = await password({
        message: 'Azure OpenAI API key:',
        validate: (v: string) => v.length > 10 || 'API key must be at least 10 characters',
      });
    }
  } else {
    const apiKeyVar = llmProvider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    if (hasKey(apiKeyVar)) {
      const change = await confirm({ message: `${llmProvider} API key${hintSecret(apiKeyVar)} — change it?`, default: false });
      if (change) {
        llmApiKey = await password({
          message: `${llmProvider} API key:`,
          validate: (v: string) => v.length > 10 || 'API key must be at least 10 characters',
        });
        await validateLlmKey(llmProvider, llmApiKey);
      } else {
        llmApiKey = prev[apiKeyVar] ?? '';
      }
    } else {
      llmApiKey = await password({
        message: `${llmProvider} API key:`,
        validate: (v: string) => v.length > 10 || 'API key must be at least 10 characters',
      });
      await validateLlmKey(llmProvider, llmApiKey);
    }
  }

  const modelChoices = (LLM_MODELS[llmProvider] ?? ['gpt-4o']).map((m) => ({ name: m, value: m }));
  const llmModel = await select({
    message: `Default model:${hint('LLM_MODEL')}`,
    choices: modelChoices,
    default: prev['LLM_MODEL'] ?? modelChoices[0]?.value,
  });

  // ── Step 2: Interface Channel ────────────────────────────────────────────
  console.log('\n' + chalk.bold('Step 2 of 5 — Interface Channel\n'));

  const prevChannel = prev['BEX_CHANNEL'];
  const channel = await select({
    message: `Primary interface channel:${hint('BEX_CHANNEL')}`,
    choices: [
      { name: `Web Dashboard only (add channels later)${prevChannel === 'dashboard' ? ' ✓' : ''}`, value: 'dashboard' },
      { name: `Telegram Bot${prevChannel === 'telegram' ? ' ✓' : ''}`, value: 'telegram' },
      { name: `Microsoft Teams${prevChannel === 'teams' ? ' ✓' : ''}`, value: 'teams' },
      { name: `WhatsApp (via Twilio)${prevChannel === 'whatsapp' ? ' ✓' : ''}`, value: 'whatsapp' },
    ],
    default: prevChannel ?? 'dashboard',
  });

  const channelEnv: Record<string, string> = {};
  if (channel === 'telegram') {
    if (hasKey('TELEGRAM_BOT_TOKEN')) {
      const change = await confirm({ message: `Telegram Bot Token${hintSecret('TELEGRAM_BOT_TOKEN')} — change it?`, default: false });
      channelEnv['TELEGRAM_BOT_TOKEN'] = change
        ? await password({ message: 'Telegram Bot Token:' })
        : prev['TELEGRAM_BOT_TOKEN'] ?? '';
    } else {
      channelEnv['TELEGRAM_BOT_TOKEN'] = await password({ message: 'Telegram Bot Token:' });
    }
    channelEnv['TELEGRAM_APPROVAL_CHAT_ID'] = await input({
      message: `Approval Chat ID (your Telegram user ID):${hint('TELEGRAM_APPROVAL_CHAT_ID')}`,
      default: prev['TELEGRAM_APPROVAL_CHAT_ID'] ?? '',
    });
  } else if (channel === 'teams') {
    channelEnv['TEAMS_WEBHOOK_URL'] = await input({
      message: `Teams Incoming Webhook URL:${hint('TEAMS_WEBHOOK_URL')}`,
      default: prev['TEAMS_WEBHOOK_URL'] ?? '',
    });
  } else if (channel === 'whatsapp') {
    channelEnv['TWILIO_ACCOUNT_SID'] = await input({
      message: `Twilio Account SID:${hint('TWILIO_ACCOUNT_SID')}`,
      default: prev['TWILIO_ACCOUNT_SID'] ?? '',
    });
    if (hasKey('TWILIO_AUTH_TOKEN')) {
      const change = await confirm({ message: `Twilio Auth Token${hintSecret('TWILIO_AUTH_TOKEN')} — change it?`, default: false });
      channelEnv['TWILIO_AUTH_TOKEN'] = change
        ? await password({ message: 'Twilio Auth Token:' })
        : prev['TWILIO_AUTH_TOKEN'] ?? '';
    } else {
      channelEnv['TWILIO_AUTH_TOKEN'] = await password({ message: 'Twilio Auth Token:' });
    }
    channelEnv['TWILIO_WHATSAPP_FROM'] = await input({ message: `WhatsApp From:${hint('TWILIO_WHATSAPP_FROM')}`, default: prev['TWILIO_WHATSAPP_FROM'] ?? '' });
    channelEnv['WHATSAPP_APPROVAL_TO'] = await input({ message: `Approval destination number:${hint('WHATSAPP_APPROVAL_TO')}`, default: prev['WHATSAPP_APPROVAL_TO'] ?? '' });
  }

  // ── Step 3: Domain integrations (XIQ / XCO) ──────────────────────────────
  console.log('\n' + chalk.bold('Step 3 of 5 — Network Integrations\n'));
  console.log(chalk.dim('  These are optional. You can add credentials later via the dashboard Vault.\n'));

  const domainEnv: Record<string, string> = {};

  const setupXiq = await confirm({ message: 'Configure ExtremeCloud IQ (XIQ)?', default: hasKey('XIQ_USERNAME') });
  if (setupXiq) {
    console.log(chalk.dim('  XIQ credentials are used to query your wireless network via the XIQ cloud API.\n'));
    domainEnv['XIQ_USERNAME'] = await input({
      message: `XIQ username (email):${hint('XIQ_USERNAME')}`,
      default: prev['XIQ_USERNAME'] ?? '',
      validate: (v: string) => v.includes('@') || 'Enter a valid email',
    });
    if (hasKey('XIQ_PASSWORD')) {
      const change = await confirm({ message: `XIQ password${hintSecret('XIQ_PASSWORD')} — change it?`, default: false });
      domainEnv['XIQ_PASSWORD'] = change ? await password({ message: 'XIQ password:' }) : prev['XIQ_PASSWORD'] ?? '';
    } else {
      domainEnv['XIQ_PASSWORD'] = await password({ message: 'XIQ password:' });
    }
  }

  const setupXco = await confirm({ message: 'Configure ExtremeCloud Orchestrator (XCO)?', default: hasKey('XCO_HOST') });
  if (setupXco) {
    console.log(chalk.dim('  XCO is your on-premises fabric orchestrator. Provide the management IP/hostname.\n'));
    domainEnv['XCO_HOST'] = await input({
      message: `XCO host (IP or hostname):${hint('XCO_HOST')}`,
      default: prev['XCO_HOST'] ?? '',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    });
    domainEnv['XCO_USERNAME'] = await input({ message: `XCO admin username:${hint('XCO_USERNAME')}`, default: prev['XCO_USERNAME'] ?? '' });
    if (hasKey('XCO_PASSWORD')) {
      const change = await confirm({ message: `XCO password${hintSecret('XCO_PASSWORD')} — change it?`, default: false });
      domainEnv['XCO_PASSWORD'] = change ? await password({ message: 'XCO admin password:' }) : prev['XCO_PASSWORD'] ?? '';
    } else {
      domainEnv['XCO_PASSWORD'] = await password({ message: 'XCO admin password:' });
    }
  }

  // ── Step 4: Admin account ────────────────────────────────────────────────
  console.log('\n' + chalk.bold('Step 4 of 5 — Admin Account\n'));

  const adminEmail = await input({
    message: `Admin email:${hint('BEX_ADMIN_EMAIL')}`,
    default: prev['BEX_ADMIN_EMAIL'] ?? '',
    validate: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Enter a valid email address',
  });

  const adminPassword = await password({
    message: `Admin password:${hintSecret('BEX_ADMIN_PASSWORD')}`,
    validate: (v: string) => (v.length === 0 && hasKey('BEX_ADMIN_PASSWORD')) || v.length >= 8 || 'Password must be at least 8 characters',
  });
  const resolvedAdminPassword = adminPassword || (prev['BEX_ADMIN_PASSWORD'] ?? '');

  let confirmPass = '';
  if (adminPassword) {
    confirmPass = await password({ message: 'Confirm password:' });
    if (adminPassword !== confirmPass) {
      printError('Passwords do not match. Run `bex init` again.');
      process.exit(1);
    }
  }

  // ── Step 5: Generate config ───────────────────────────────────────────────
  console.log('\n' + chalk.bold('Step 5 of 5 — Generating configuration\n'));

  const skillRegistryToken = await input({
    message: `Skill registry auth token (leave blank if open):${hint('SKILL_REGISTRY_TOKEN')}`,
    default: prev['SKILL_REGISTRY_TOKEN'] ?? '',
  });

  const spinner = ora('Generating secrets...').start();
  // Preserve existing JWT/vault secrets if already set — no need to rotate them
  const jwtSecret = prev['JWT_SECRET'] || randomBytes(32).toString('hex');
  const vaultKey = prev['CREDENTIAL_VAULT_KEY'] || randomBytes(32).toString('hex');
  // Postgres and Redis use hardcoded defaults matching infra/docker-compose.yml
  const pgPassword = 'bexpassword';
  const redisPassword = 'bexpassword';
  spinner.succeed('Secrets generated');

  const envVars: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: `postgresql://bex:${pgPassword}@localhost:5432/bex?schema=public`,
    POSTGRES_PASSWORD: pgPassword,
    POSTGRES_USER: 'bex',
    POSTGRES_DB: 'bex',
    REDIS_URL: `redis://:${redisPassword}@localhost:6379`,
    REDIS_PASSWORD: redisPassword,
    JWT_SECRET: jwtSecret,
    CREDENTIAL_VAULT_KEY: vaultKey,
    LLM_PROVIDER: llmProvider,
    LLM_MODEL: llmModel,
    OLLAMA_BASE_URL: llmProvider === 'ollama' ? ollamaBaseUrl : (prev['OLLAMA_BASE_URL'] ?? ''),
    ...(llmProvider === 'azure' && azureEndpoint && { AZURE_OPENAI_ENDPOINT: azureEndpoint }),
    ...(llmProvider === 'azure' && azureApiVersion && { AZURE_OPENAI_API_VERSION: azureApiVersion }),
    PORT: '4000',
    ADMIN_API_PORT: '4001',
    DASHBOARD_PORT: '3000',
    KNOWLEDGE_DIR: './knowledge',
    KNOWLEDGE_BASE_DIR: './knowledge',
    SKILL_REGISTRY_URL: 'https://bexregistry.brendanbonner.com',
    SKILL_REGISTRY_TOKEN: skillRegistryToken,
    LOG_LEVEL: 'info',
    CORS_ORIGIN: 'http://localhost:3000',
    RATE_LIMIT_MAX: '100',
    DEFAULT_APPROVAL_CHANNEL: channel !== 'dashboard' ? channel : '',
    // Non-sensitive channel metadata (approval routing — not secrets)
    ...(channelEnv['TELEGRAM_APPROVAL_CHAT_ID'] && { TELEGRAM_APPROVAL_CHAT_ID: channelEnv['TELEGRAM_APPROVAL_CHAT_ID'] }),
    BEX_ADMIN_EMAIL: adminEmail,
    BEX_CHANNEL: channel,
    // Integration flags — tell api-gateway which domains are configured so
    // provision.ts can create default agents even before credentials are in vault
    ...(setupXiq && { BEX_XIQ_ENABLED: 'true' }),
    ...(setupXco && { BEX_XCO_ENABLED: 'true' }),
    // All sensitive credentials (LLM keys, tokens, passwords) go to the
    // credential vault only — never stored in .env.
  };

  writeEnv(envVars);
  printSuccess('.env written');

  const shouldStart = await confirm({ message: 'Start the platform now?', default: true });

  if (!shouldStart) {
    console.log('\n' + chalk.dim('Run `bex start` when ready.'));
    return;
  }

  if (!isDockerRunning()) {
    printError('Docker is not running. Please start Docker and run `bex start`.');
    process.exit(1);
  }

  // ── Start infrastructure (postgres + redis) ───────────────────────────────
  console.log('');
  const infraSpinner = ora('Starting infrastructure (postgres, redis)…').start();
  try {
    ensureInfraRunning(root);
    infraSpinner.succeed('Infrastructure ready');
  } catch {
    infraSpinner.warn('Could not start Docker infra — ensure postgres + redis are running');
  }
  await new Promise((r) => setTimeout(r, 2000));

  // ── Wait for PostgreSQL to accept connections ─────────────────────────────
  const pgSpinner = ora('Waiting for PostgreSQL to be ready…').start();
  const pgUser = envVars['POSTGRES_USER'] ?? 'bex';
  const pgReady = await waitForPostgres(root, pgUser, 60_000);
  if (!pgReady) {
    pgSpinner.fail('PostgreSQL did not become ready in 60s — check Docker is running');
    process.exit(1);
  }
  pgSpinner.succeed('PostgreSQL ready');

  // ── Run DB migrations ────────────────────────────────────────────────────
  const migrateSpinner = ora('Running database migrations…').start();
  const migrateEnv = { ...process.env, ...envVars };
  const schemaPath = resolve(root, 'packages/shared/prisma/schema.prisma');
  const migrationsDir = resolve(root, 'packages/shared/prisma/migrations');

  // Prefer migrate deploy (tracks history) when migration files exist;
  // fall back to db push for fresh clones where migrations haven't been generated yet.
  const usePush = !existsSync(migrationsDir);
  const migrateArgs = usePush
    ? ['prisma', 'db', 'push', '--schema', schemaPath, '--skip-generate', '--accept-data-loss']
    : ['prisma', 'migrate', 'deploy', '--schema', schemaPath];

  const migrateResult = spawnSync(
    'npx', migrateArgs,
    { cwd: root, env: migrateEnv, stdio: 'pipe', encoding: 'utf-8' },
  );
  if (migrateResult.status !== 0) {
    migrateSpinner.fail('Database schema setup failed — cannot continue');
    if (migrateResult.stdout) console.error(chalk.dim(migrateResult.stdout.slice(0, 600)));
    if (migrateResult.stderr) console.error(chalk.dim(migrateResult.stderr.slice(0, 600)));
    console.log(chalk.yellow('\nFix the issue above then re-run: bex init'));
    process.exit(1);
  } else {
    migrateSpinner.succeed(usePush ? 'Database schema applied (db push)' : 'Database migrations applied');
  }

  // ── Build dashboard (first time) ─────────────────────────────────────────
  if (!existsSync(resolve(root, 'apps/dashboard/.next/standalone/apps/dashboard/server.js'))) {
    const dashSpinner = ora('Building dashboard (first run, ~60s)…').start();
    const result = spawnSync('npm', ['run', 'build', '--silent'], {
      cwd: resolve(root, 'apps/dashboard'),
      stdio: 'pipe',
      encoding: 'utf-8',
      env: migrateEnv,
    });
    if (result.status !== 0) {
      dashSpinner.warn('Dashboard build had warnings — check `bex logs dashboard`');
    } else {
      ensureDashboardBuilt(root);
      dashSpinner.succeed('Dashboard built');
    }
  }

  // ── Start all app services via pm2 ───────────────────────────────────────
  const startSpinner = ora('Starting services via pm2…').start();
  startLocalServices(root);
  startSpinner.succeed('Services started');

  await new Promise((r) => setTimeout(r, 5000));

  // ── Wait for API ─────────────────────────────────────────────────────────
  const apiReady = await waitForService('http://localhost:4000/health', 'API Gateway', 90_000);
  if (!apiReady) {
    printWarning('API Gateway did not start in time. Check: bex logs api');
    return;
  }

  // ── Bootstrap admin account ───────────────────────────────────────────────
  const setupSpinner = ora('Creating admin account…').start();
  let adminToken = '';
  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch('http://localhost:4000/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEmail, adminPassword: resolvedAdminPassword, llmProvider, llmApiKey, llmModel, channel,
        channelConfig: channelEnv,
        ...(ollamaBaseUrl && { ollamaBaseUrl }),
      }),
    });
    const json = (await res.json()) as { ok: boolean; data?: { adminToken?: string }; error?: unknown };
    if (res.status === 409) {
      setupSpinner.info('Platform already configured — admin account exists');
    } else if (json.ok) {
      setupSpinner.succeed('Admin account created');
      adminToken = json.data?.adminToken ?? '';
    } else {
      const errMsg = json.error && typeof json.error === 'object' && 'message' in json.error
        ? String((json.error as { message: unknown }).message)
        : JSON.stringify(json.error ?? 'unknown');
      setupSpinner.warn(`Setup: ${errMsg}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setupSpinner.warn(`Could not call setup API: ${message}`);
  }

  // ── Store sensitive credentials in vault, remove from .env ───────────────
  if (adminToken) {
    // Write BEX_BOT_API_KEY first so the Telegram bot picks it up on restart below.
    writeEnv({ BEX_BOT_API_KEY: adminToken });

    const vaultSpinner = ora('Storing secrets in credential vault…').start();
    try {
      const { default: fetch } = await import('node-fetch');
      const authHeader = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

      async function storeSystemCred(
        name: string,
        credentialType: 'API_TOKEN' | 'USERNAME_PASSWORD',
        value: Record<string, string>,
      ): Promise<void> {
        await fetch('http://localhost:4000/credentials', {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({ name, scope: 'SYSTEM', credentialType, value }),
        });
      }

      // Store LLM key under the well-known system name so loadSystemSecrets
      // can inject it into process.env on subsequent service restarts.
      const llmKeyVar = llmProvider === 'openai' ? 'OPENAI_API_KEY'
        : llmProvider === 'anthropic' ? 'ANTHROPIC_API_KEY'
        : llmProvider === 'azure' ? 'AZURE_OPENAI_API_KEY'
        : ''; // ollama has no API key to store
      if (llmApiKey && llmKeyVar) {
        await storeSystemCred(`system.${llmKeyVar.toLowerCase()}`, 'API_TOKEN', { [llmKeyVar.toLowerCase()]: llmApiKey });
      }
      if (channelEnv['TELEGRAM_BOT_TOKEN']) {
        await storeSystemCred('system.telegram_bot_token', 'API_TOKEN', { telegram_bot_token: channelEnv['TELEGRAM_BOT_TOKEN'] });
      }
      if (domainEnv['XIQ_USERNAME']) {
        await storeSystemCred('system.xiq_credentials', 'USERNAME_PASSWORD', {
          xiq_username: domainEnv['XIQ_USERNAME'] ?? '',
          xiq_password: domainEnv['XIQ_PASSWORD'] ?? '',
        });
      }
      if (domainEnv['XCO_HOST']) {
        await storeSystemCred('system.xco_credentials', 'USERNAME_PASSWORD', {
          xco_host: domainEnv['XCO_HOST'] ?? '',
          xco_username: domainEnv['XCO_USERNAME'] ?? '',
          xco_password: domainEnv['XCO_PASSWORD'] ?? '',
        });
      }
      if (channelEnv['TWILIO_ACCOUNT_SID']) {
        await storeSystemCred('system.twilio_credentials', 'API_TOKEN', {
          twilio_account_sid: channelEnv['TWILIO_ACCOUNT_SID'] ?? '',
          twilio_auth_token: channelEnv['TWILIO_AUTH_TOKEN'] ?? '',
          twilio_whatsapp_from: channelEnv['TWILIO_WHATSAPP_FROM'] ?? '',
          whatsapp_approval_to: channelEnv['WHATSAPP_APPROVAL_TO'] ?? '',
        });
      }

      vaultSpinner.succeed('Secrets stored in credential vault');

      // Restart the Telegram bot now that its token is in the vault.
      // It starts alongside all other services (before vault is populated) and
      // may still be in its retry loop — a restart gives it a clean start.
      if (channel === 'telegram' || channelEnv['TELEGRAM_BOT_TOKEN']) {
        restartService('bex-telegram');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vaultSpinner.warn(`Could not store in vault (${message}) — re-run bex init to retry`);
    }
  }

  await waitForService('http://localhost:3000', 'Dashboard', 60_000);

  // ── Pull domain skills from registry (fast path) ──────────────────────────
  const { default: fetch } = await import('node-fetch');

  // Log in to get a JWT for registry operations
  let registryAuthHeader: Record<string, string> = {};
  if (adminToken) {
    registryAuthHeader = { Authorization: `Bearer ${adminToken}` };
  } else {
    try {
      const loginRes = await fetch('http://localhost:4000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: resolvedAdminPassword }),
      });
      const loginJson = (await loginRes.json()) as { ok: boolean; data?: { token?: string } };
      if (loginJson.ok && loginJson.data?.token) {
        registryAuthHeader = { Authorization: `Bearer ${loginJson.data.token}` };
        // Persist as bot API key so Telegram/Teams bots can call the API without separate auth
        writeEnv({ BEX_BOT_API_KEY: loginJson.data.token });
      }
    } catch { /* proceed without auth */ }
  }

  async function batchInstallFromRegistry(domains: readonly string[]): Promise<string[]> {
    const skillIds: string[] = [];
    await Promise.all(
      domains.map(async (domain) => {
        try {
          const res = await fetch(
            `http://localhost:4000/registry/install/${encodeURIComponent(domain)}/1.0.0`,
            { method: 'POST', headers: { 'Content-Type': 'application/json', ...registryAuthHeader } },
          );
          const json = (await res.json()) as { ok: boolean; data?: { skillId?: string } };
          if (json.ok && json.data?.skillId) skillIds.push(json.data.skillId);
        } catch { /* silent — fall through to local build */ }
      }),
    );
    return skillIds;
  }

  async function pushSkillsToRegistry(domainPrefix: string): Promise<void> {
    if (!envVars['SKILL_REGISTRY_TOKEN']) return;
    try {
      const res = await fetch('http://localhost:4000/skills', { headers: registryAuthHeader });
      const json = (await res.json()) as { ok: boolean; data?: Array<{ id: string; domain?: string }> };
      const skills = (json.data ?? []).filter((s) => s.domain?.startsWith(domainPrefix));
      await Promise.all(
        skills.map((s) =>
          fetch(`http://localhost:4000/skills/${s.id}/publish-to-registry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...registryAuthHeader },
          }).catch(() => {}),
        ),
      );
    } catch { /* non-fatal */ }
  }

  async function createDefaultAgent(opts: {
    name: string;
    description: string;
    systemPrompt: string;
    skillIds: string[];
    permissions: string[];
    posture: 'AUTONOMOUS' | 'SUPERVISED' | 'INTERACTIVE';
    mandate: string;
    conductBoundaries: string[];
  }): Promise<boolean> {
    if (opts.skillIds.length === 0) return false;
    const sp = ora(`Creating agent: ${opts.name}…`).start();
    try {
      // Create agent
      const agentRes = await fetch('http://localhost:4000/agents', {
        method: 'POST',
        headers: { ...registryAuthHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: opts.name,
          description: opts.description,
          llmProvider,
          llmModel,
          permissions: opts.permissions,
          skillIds: opts.skillIds,
          persona: { systemPrompt: opts.systemPrompt },
        }),
      });
      const agentJson = (await agentRes.json()) as { ok: boolean; data?: { id?: string } };
      if (!agentJson.ok || !agentJson.data?.id) {
        sp.warn(`Could not create agent: ${opts.name}`);
        return false;
      }
      const agentId = agentJson.data.id;
      // Set charter
      await fetch(`http://localhost:4000/agents/${agentId}/charter`, {
        method: 'PUT',
        headers: { ...registryAuthHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mandate: opts.mandate,
          posture: opts.posture,
          conductBoundaries: opts.conductBoundaries,
        }),
      });
      sp.succeed(`Agent ready: ${opts.name} (${agentId.slice(-8)})`);
      return true;
    } catch {
      sp.warn(`Could not create agent: ${opts.name}`);
      return false;
    }
  }

  // Derive the LLM API key env var name for passing to subprocesses
  const llmApiKeyVar = llmProvider === 'openai' ? 'OPENAI_API_KEY'
    : llmProvider === 'anthropic' ? 'ANTHROPIC_API_KEY'
    : llmProvider === 'azure' ? 'AZURE_OPENAI_API_KEY'
    : ''; // ollama has no API key
  const subprocEnvBase = {
    ...process.env,
    DATABASE_URL:          envVars['DATABASE_URL']!,
    CREDENTIAL_VAULT_KEY:  envVars['CREDENTIAL_VAULT_KEY']!,
    LLM_PROVIDER:          llmProvider,
    LLM_MODEL:             llmModel,
    SKILL_REGISTRY_URL:    envVars['SKILL_REGISTRY_URL'] ?? '',
    SKILL_REGISTRY_TOKEN:  envVars['SKILL_REGISTRY_TOKEN'] ?? '',
    ...(llmApiKey && llmApiKeyVar ? { [llmApiKeyVar]: llmApiKey } : {}),
    ...(ollamaBaseUrl ? { OLLAMA_BASE_URL: ollamaBaseUrl } : {}),
    ...(azureEndpoint ? { AZURE_OPENAI_ENDPOINT: azureEndpoint } : {}),
    ...(azureApiVersion ? { AZURE_OPENAI_API_VERSION: azureApiVersion } : {}),
  };

  let xiqReady = false;
  let xcoReady = false;

  const hasAuth = Object.keys(registryAuthHeader).length > 0;

  if (setupXiq) {
    if (!hasAuth) {
      ora('').info('ExtremeCloud IQ: setup did not complete — re-run bex init to install skills');
    } else {
      const xiqDomains = [
        'extremecloudiq.networking',
        'extremecloudiq.devices',
        'extremecloudiq.clients',
        'extremecloudiq.monitoring',
        'extremecloudiq.alerts.logs',
        'extremecloudiq.network.policy',
        'extremecloudiq.network.config',
        'extremecloudiq.network.auth',
        'extremecloudiq.location',
        'extremecloudiq.wireless',
        'extremecloudiq.topology',
        'extremecloudiq.composite',
      ] as const;

      console.log('');
      const xiqSp = ora('Installing ExtremeCloud IQ skills…').start();
      const xiqRegistryIds = await batchInstallFromRegistry(xiqDomains);

      if (xiqRegistryIds.length > 0) {
        xiqSp.succeed('ExtremeCloud IQ skills installed from registry');
        xiqReady = true;
        await createDefaultAgent({
          name: 'ExtremeCloud IQ',
          description: 'Manages and monitors your ExtremeCloud IQ wireless network — devices, clients, alerts, policies, and more.',
          systemPrompt: `You are a comprehensive ExtremeCloud IQ network assistant.

You can: list and monitor devices, view client connections, check alerts and logs, manage network policies, and more.

IMPORTANT: For any write operation (create, update, delete, push config), always:
1. Describe exactly what will change
2. Ask for explicit confirmation before proceeding
3. Report the outcome clearly

Be concise and clear in your responses.`,
          skillIds: xiqRegistryIds,
          permissions: ['xiq:read', 'xiq:write'],
          posture: 'SUPERVISED',
          mandate: 'Manage and monitor ExtremeCloud IQ. Read operations are autonomous. Write operations require human approval.',
          conductBoundaries: ['delete:*', 'push:config'],
        });
      } else {
        xiqSp.text = 'ExtremeCloud IQ skills not in registry — building from OpenAPI spec…';
        const buildResult = spawnSync(
          'npx', ['tsx', 'scripts/seed-xciq-full.ts'],
          {
            cwd: root,
            env: {
              ...subprocEnvBase,
              XIQ_USERNAME: domainEnv['XIQ_USERNAME'] ?? '',
              XIQ_PASSWORD: domainEnv['XIQ_PASSWORD'] ?? '',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf-8',
            timeout: 180_000,
          },
        );
        if (buildResult.status === 0 && !buildResult.error) {
          xiqSp.succeed('ExtremeCloud IQ skills built and agent created');
          xiqReady = true;
          await pushSkillsToRegistry('extremecloudiq.');
        } else {
          xiqSp.info('ExtremeCloud IQ skills not available — run: npx tsx scripts/seed-xciq-full.ts');
        }
      }
    }
  }

  if (setupXco) {
    if (!hasAuth) {
      ora('').info('ExtremeCloud Orchestrator: setup did not complete — re-run bex init to install skills');
    } else {
      const xcoDomains = [
        'networking.extreme-xco.monitor',
        'networking.extreme-xco.operations',
        'networking.extreme-xco.diagnostics',
        'networking.extreme-xco.telemetry',
        'networking.extreme-xco.composite',
      ] as const;

      console.log('');
      const xcoSp = ora('Installing ExtremeCloud Orchestrator skills…').start();
      const xcoRegistryIds = await batchInstallFromRegistry(xcoDomains);

      if (xcoRegistryIds.length > 0) {
        xcoSp.succeed('ExtremeCloud Orchestrator skills installed from registry');
        xcoReady = true;
        await createDefaultAgent({
          name: 'ExtremeCloud Orchestrator',
          description: 'Monitors and manages your ExtremeCloud Orchestrator fabric network — health, alarms, topology, and operations.',
          systemPrompt: `You are an ExtremeCloud Orchestrator (XCO) network agent.

You can: monitor fabric health and topology, retrieve alarms, check device inventory, validate CLOS topology, detect configuration drift.

Write operations (fabric creation, switch management, alarm management) require explicit approval.

Be concise and technical in your responses.`,
          skillIds: xcoRegistryIds,
          permissions: ['xco:read', 'xco:write'],
          posture: 'SUPERVISED',
          mandate: 'Monitor and manage ExtremeCloud Orchestrator. Read operations are autonomous. Write operations require approval.',
          conductBoundaries: ['delete:*', 'fabric:reset', 'switch:remove'],
        });
      } else {
        xcoSp.text = 'ExtremeCloud Orchestrator skills not in registry — building locally…';
        const buildResult = spawnSync(
          'npx', ['tsx', 'scripts/seed-xco-full.ts'],
          {
            cwd: root,
            env: {
              ...subprocEnvBase,
              XCO_HOST:     domainEnv['XCO_HOST'] ?? '',
              XCO_USERNAME: domainEnv['XCO_USERNAME'] ?? 'extreme',
              XCO_PASSWORD: domainEnv['XCO_PASSWORD'] ?? '',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf-8',
            timeout: 240_000,
          },
        );
        if (buildResult.status === 0 && !buildResult.error) {
          xcoSp.succeed('ExtremeCloud Orchestrator skills built and agent created');
          xcoReady = true;
          await pushSkillsToRegistry('networking.extreme-xco.');
        } else {
          xcoSp.info('ExtremeCloud Orchestrator skills not available — run: npx tsx scripts/seed-xco-full.ts');
        }
      }
    }
  }

  // ── Persist Telegram/bot env vars ─────────────────────────────────────────
  // Look up the best default agent ID and save it so the Telegram bot can route
  // messages to it automatically. Prefers the XIQ agent; falls back to any agent.
  if (channelEnv['TELEGRAM_BOT_TOKEN'] || channel === 'telegram') {
    try {
      const agentsRes = await fetch('http://localhost:4000/agents', { headers: registryAuthHeader });
      const agentsJson = (await agentsRes.json()) as { ok: boolean; data?: Array<{ id: string; name: string }> };
      const agents = agentsJson.data ?? [];
      const bestAgent =
        agents.find((a) => a.name === 'ExtremeCloud IQ Monitor' || a.name === 'ExtremeCloud IQ') ??
        agents[0];
      if (bestAgent) {
        writeEnv({ TELEGRAM_DEFAULT_AGENT_ID: bestAgent.id });
        printSuccess(`TELEGRAM_DEFAULT_AGENT_ID set to "${bestAgent.name}" (${bestAgent.id})`);
      } else {
        // Agents are seeded by the domain setup steps (seed-xciq-full.ts etc.) which
        // run after init.  The Telegram bot will auto-discover the agent on first use.
        // The user can also set it manually once they know the agent ID.
        console.log(
          chalk.yellow('\n  ⚠ No agents found yet — the Telegram bot will auto-discover the default agent on startup.\n') +
          chalk.dim('    Once your agent is created, you can pin it by adding to .env:\n') +
          chalk.dim('      TELEGRAM_DEFAULT_AGENT_ID=<agent-uuid from /agents API or dashboard>\n') +
          chalk.dim('    Do NOT paste the Telegram bot token here — this must be a BEX agent ID.\n'),
        );
      }
    } catch { /* non-fatal */ }
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('');
  const V = chalk.bold.magenta;
  const D = chalk.dim;
  const B = chalk.bold;
  console.log(V('  ╔══════════════════════════════════════════════════════╗'));
  console.log(V('  ║') + B('  ✓ BEX is running!                                  ') + V('║'));
  console.log(V('  ╠══════════════════════════════════════════════════════╣'));
  console.log(V('  ║') + chalk.white('  Dashboard  →  http://localhost:3000               ') + V('║'));
  console.log(V('  ║') + chalk.white('  API        →  http://localhost:4000               ') + V('║'));
  console.log(V('  ║') + chalk.white('  Registry   →  http://localhost:5050               ') + V('║'));
  console.log(V('  ╠══════════════════════════════════════════════════════╣'));
  console.log(V('  ║') + D(`  Login: ${adminEmail.padEnd(44)}`) + V('║'));
  console.log(V('  ╠══════════════════════════════════════════════════════╣'));
  if (setupXiq && xiqReady) console.log(V('  ║') + chalk.green('  ✓ ExtremeCloud IQ agent + skills ready             ') + V('║'));
  if (setupXco && xcoReady) console.log(V('  ║') + chalk.green('  ✓ ExtremeCloud Orchestrator agent ready            ') + V('║'));
  if (setupXiq && !xiqReady) console.log(V('  ║') + chalk.yellow('  ⚠ XIQ: run npx tsx scripts/seed-xciq-full.ts      ') + V('║'));
  if (setupXco && !xcoReady) console.log(V('  ║') + chalk.yellow('  ⚠ XCO: run npx tsx scripts/seed-xco-full.ts       ') + V('║'));
  if (!setupXiq) console.log(V('  ║') + D('  XIQ: re-run bex init or add creds via dashboard    ') + V('║'));
  if (!setupXco) console.log(V('  ║') + D('  XCO: re-run bex init or add creds via dashboard    ') + V('║'));
  console.log(V('  ╠══════════════════════════════════════════════════════╣'));
  console.log(V('  ║') + D('  bex status   — health check all services          ') + V('║'));
  console.log(V('  ║') + D('  bex logs     — tail all logs                      ') + V('║'));
  console.log(V('  ╚══════════════════════════════════════════════════════╝'));
  console.log('');
  process.exit(0);
}
