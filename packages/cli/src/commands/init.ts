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
  isDockerRunning, ensureInfraRunning, ensureDashboardBuilt, startLocalServices,
} from '../utils.js';

const LLM_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  azure: ['gpt-4o', 'gpt-4-turbo'],
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

  if (llmProvider === 'ollama') {
    ollamaBaseUrl = await input({
      message: `Ollama base URL:${hint('OLLAMA_BASE_URL')}`,
      default: prev['OLLAMA_BASE_URL'] || 'http://localhost:11434',
    });
    console.log(chalk.dim('  Make sure Ollama is running and the model is pulled (e.g. ollama pull llama3.2)'));
  } else {
    const apiKeyVar = llmProvider === 'openai' ? 'OPENAI_API_KEY'
      : llmProvider === 'anthropic' ? 'ANTHROPIC_API_KEY'
      : 'AZURE_OPENAI_API_KEY';
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

  const setupXiq = await confirm({ message: 'Configure ExtremeCloud IQ (XIQ)?', default: hasKey('XCIQ_USERNAME') });
  if (setupXiq) {
    console.log(chalk.dim('  XIQ credentials are used to query your wireless network via the XIQ cloud API.\n'));
    domainEnv['XCIQ_USERNAME'] = await input({
      message: `XIQ username (email):${hint('XCIQ_USERNAME')}`,
      default: prev['XCIQ_USERNAME'] ?? '',
      validate: (v: string) => v.includes('@') || 'Enter a valid email',
    });
    if (hasKey('XCIQ_PASSWORD')) {
      const change = await confirm({ message: `XIQ password${hintSecret('XCIQ_PASSWORD')} — change it?`, default: false });
      domainEnv['XCIQ_PASSWORD'] = change ? await password({ message: 'XIQ password:' }) : prev['XCIQ_PASSWORD'] ?? '';
    } else {
      domainEnv['XCIQ_PASSWORD'] = await password({ message: 'XIQ password:' });
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
    // LLM API keys written temporarily so services can start; moved to vault below
    OPENAI_API_KEY: llmProvider === 'openai' ? llmApiKey : (prev['OPENAI_API_KEY'] ?? ''),
    ANTHROPIC_API_KEY: llmProvider === 'anthropic' ? llmApiKey : (prev['ANTHROPIC_API_KEY'] ?? ''),
    AZURE_OPENAI_API_KEY: llmProvider === 'azure' ? llmApiKey : (prev['AZURE_OPENAI_API_KEY'] ?? ''),
    OLLAMA_BASE_URL: llmProvider === 'ollama' ? ollamaBaseUrl : (prev['OLLAMA_BASE_URL'] ?? ''),
    LLM_MODEL: llmModel,
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
    ...channelEnv,
    ...domainEnv,
    BEX_ADMIN_EMAIL: adminEmail,
    BEX_ADMIN_PASSWORD: resolvedAdminPassword,
    BEX_CHANNEL: channel,
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

  // ── Run DB migrations ────────────────────────────────────────────────────
  const migrateSpinner = ora('Running database migrations…').start();
  const migrateEnv = { ...process.env, ...envVars };
  const migrateResult = spawnSync(
    'npx', ['prisma', 'migrate', 'deploy', '--schema', resolve(root, 'packages/shared/prisma/schema.prisma')],
    { cwd: root, env: migrateEnv, stdio: 'pipe', encoding: 'utf-8' },
  );
  if (migrateResult.status !== 0) {
    migrateSpinner.warn('Migration warning — check `bex logs` if services fail to start');
    if (migrateResult.stderr) console.error(chalk.dim(migrateResult.stderr.slice(0, 400)));
  } else {
    migrateSpinner.succeed('Database migrations applied');
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
    const vaultSpinner = ora('Moving secrets to credential vault…').start();
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

      const llmKeyVar = llmProvider === 'openai' ? 'OPENAI_API_KEY'
        : llmProvider === 'anthropic' ? 'ANTHROPIC_API_KEY'
        : 'AZURE_OPENAI_API_KEY';
      const currentLlmKey = envVars[llmKeyVar];
      if (currentLlmKey) {
        await storeSystemCred(`system.${llmKeyVar.toLowerCase()}`, 'API_TOKEN', { [llmKeyVar.toLowerCase()]: currentLlmKey });
      }
      if (channelEnv['TELEGRAM_BOT_TOKEN']) {
        await storeSystemCred('system.telegram_bot_token', 'API_TOKEN', { telegram_bot_token: channelEnv['TELEGRAM_BOT_TOKEN'] });
      }
      if (domainEnv['XCIQ_USERNAME']) {
        await storeSystemCred('system.xciq_credentials', 'USERNAME_PASSWORD', {
          xciq_username: domainEnv['XCIQ_USERNAME'] ?? '',
          xciq_password: domainEnv['XCIQ_PASSWORD'] ?? '',
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

      // Strip sensitive keys from .env — vault is now the source of truth
      const keysToRemove = [
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AZURE_OPENAI_API_KEY',
        'TELEGRAM_BOT_TOKEN', 'XCIQ_USERNAME', 'XCIQ_PASSWORD',
        'XCO_HOST', 'XCO_USERNAME', 'XCO_PASSWORD',
        'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'WHATSAPP_APPROVAL_TO',
        'BEX_ADMIN_PASSWORD',
      ];
      const cleanedVars = Object.fromEntries(
        Object.entries(envVars).filter(([k]) => !keysToRemove.includes(k)),
      );
      writeEnv(cleanedVars);

      vaultSpinner.succeed('Secrets stored in vault — removed from .env');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vaultSpinner.warn(`Could not store in vault (${message}) — secrets remain in .env`);
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
      }
    } catch { /* proceed without auth */ }
  }

  async function pullSkillFromRegistry(
    label: string,
    domain: string,
    version = '1.0.0',
  ): Promise<boolean> {
    console.log('');
    const sp = ora(`Installing ${label} skill from registry…`).start();
    try {
      const res = await fetch(
        `http://localhost:4000/registry/install/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...registryAuthHeader } },
      );
      const json = (await res.json()) as { ok: boolean; error?: unknown };
      if (json.ok) {
        sp.succeed(`${label} skill installed from registry`);
        return true;
      }
      sp.warn(`${label} not in registry — build manually: bex skill build`);
      return false;
    } catch {
      sp.warn(`Could not reach registry — build manually: bex skill build`);
      return false;
    }
  }

  let xiqReady = false;
  let xcoReady = false;

  if (setupXiq) {
    xiqReady = await pullSkillFromRegistry('ExtremeCloud IQ', 'extremecloudiq.networking');
    if (!xiqReady) {
      console.log(chalk.dim('  To build from scratch: npx tsx scripts/seed-xciq-full.ts'));
    }
  }

  if (setupXco) {
    const monitorOk = await pullSkillFromRegistry('XCO Monitor', 'networking.extreme-xco.monitor');
    const opsOk = await pullSkillFromRegistry('XCO Operations', 'networking.extreme-xco.operations');
    xcoReady = monitorOk && opsOk;
    if (!xcoReady) {
      console.log(chalk.dim('  To build from scratch: node scripts/setup-xco.js'));
    }
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
  if (setupXiq && xiqReady) console.log(V('  ║') + chalk.green('  ✓ ExtremeCloud IQ skills ready                     ') + V('║'));
  if (setupXco && xcoReady) console.log(V('  ║') + chalk.green('  ✓ ExtremeCloud Orchestrator skills ready           ') + V('║'));
  if (setupXiq && !xiqReady) console.log(V('  ║') + chalk.yellow('  ⚠ XIQ: run npx tsx scripts/seed-xciq-full.ts      ') + V('║'));
  if (setupXco && !xcoReady) console.log(V('  ║') + chalk.yellow('  ⚠ XCO: run node scripts/setup-xco.js              ') + V('║'));
  if (!setupXiq) console.log(V('  ║') + D('  XIQ: re-run bex init or add creds via dashboard    ') + V('║'));
  if (!setupXco) console.log(V('  ║') + D('  XCO: re-run bex init or add creds via dashboard    ') + V('║'));
  console.log(V('  ╠══════════════════════════════════════════════════════╣'));
  console.log(V('  ║') + D('  bex status   — health check all services          ') + V('║'));
  console.log(V('  ║') + D('  bex logs     — tail all logs                      ') + V('║'));
  console.log(V('  ╚══════════════════════════════════════════════════════╝'));
  console.log('');
}
