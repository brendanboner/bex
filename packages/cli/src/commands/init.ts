import { input, password, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  printBanner, printSuccess, printError, printWarning,
  findProjectRoot, writeEnv, waitForService,
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
  try {
    const root = findProjectRoot();
    const envPath = `${root}/.env`;
    if (existsSync(envPath)) {
      const overwrite = await confirm({
        message: chalk.yellow('.env already exists. Overwrite and re-configure?'),
        default: false,
      });
      if (!overwrite) {
        console.log('\n' + chalk.dim('Run `bex start` to start the platform.'));
        return;
      }
    }
  } catch {
    printError('Could not locate project root. Run bex from inside the Forge directory.');
    process.exit(1);
  }

  const root = findProjectRoot();

  // ── Step 1: LLM ─────────────────────────────────────────────────────────
  console.log(chalk.bold('Step 1 of 5 — LLM Provider\n'));

  const llmProvider = await select({
    message: 'LLM provider:',
    choices: [
      { name: 'OpenAI (GPT-4o)', value: 'openai' },
      { name: 'Anthropic (Claude)', value: 'anthropic' },
      { name: 'Ollama (local, no API key)', value: 'ollama' },
      { name: 'Azure OpenAI', value: 'azure' },
    ],
  });

  let llmApiKey = '';
  let ollamaBaseUrl = '';

  if (llmProvider === 'ollama') {
    ollamaBaseUrl = await input({
      message: 'Ollama base URL:',
      default: 'http://localhost:11434',
    });
    console.log(chalk.dim('  Make sure Ollama is running and the model is pulled (e.g. ollama pull llama3.2)'));
  } else {
    llmApiKey = await password({
      message: `${llmProvider} API key:`,
      validate: (v: string) => v.length > 10 || 'API key must be at least 10 characters',
    });
    await validateLlmKey(llmProvider, llmApiKey);
  }

  const modelChoices = (LLM_MODELS[llmProvider] ?? ['gpt-4o']).map((m) => ({ name: m, value: m }));
  const llmModel = await select({ message: 'Default model:', choices: modelChoices });

  // ── Step 2: Interface Channel ────────────────────────────────────────────
  console.log('\n' + chalk.bold('Step 2 of 5 — Interface Channel\n'));

  const channel = await select({
    message: 'Primary interface channel:',
    choices: [
      { name: 'Web Dashboard only (add channels later)', value: 'dashboard' },
      { name: 'Telegram Bot', value: 'telegram' },
      { name: 'Microsoft Teams', value: 'teams' },
      { name: 'WhatsApp (via Twilio)', value: 'whatsapp' },
    ],
  });

  const channelEnv: Record<string, string> = {};
  if (channel === 'telegram') {
    channelEnv['TELEGRAM_BOT_TOKEN'] = await password({ message: 'Telegram Bot Token:' });
    channelEnv['TELEGRAM_APPROVAL_CHAT_ID'] = await input({ message: 'Approval Chat ID (your Telegram user ID):' });
  } else if (channel === 'teams') {
    channelEnv['TEAMS_WEBHOOK_URL'] = await input({ message: 'Teams Incoming Webhook URL:' });
  } else if (channel === 'whatsapp') {
    channelEnv['TWILIO_ACCOUNT_SID'] = await input({ message: 'Twilio Account SID:' });
    channelEnv['TWILIO_AUTH_TOKEN'] = await password({ message: 'Twilio Auth Token:' });
    channelEnv['TWILIO_WHATSAPP_FROM'] = await input({ message: 'WhatsApp From (e.g. whatsapp:+14155238886):' });
    channelEnv['WHATSAPP_APPROVAL_TO'] = await input({ message: 'Approval destination number:' });
  }

  // ── Step 3: Domain integrations (XIQ / XCO) ──────────────────────────────
  console.log('\n' + chalk.bold('Step 3 of 5 — Network Integrations\n'));
  console.log(chalk.dim('  These are optional. You can add credentials later via the dashboard Vault.\n'));

  const domainEnv: Record<string, string> = {};

  const setupXiq = await confirm({ message: 'Configure ExtremeCloud IQ (XIQ)?', default: false });
  if (setupXiq) {
    console.log(chalk.dim('  XIQ credentials are used to query your wireless network via the XIQ cloud API.\n'));
    domainEnv['XCIQ_USERNAME'] = await input({
      message: 'XIQ username (email):',
      validate: (v: string) => v.includes('@') || 'Enter a valid email',
    });
    domainEnv['XCIQ_PASSWORD'] = await password({ message: 'XIQ password:' });
  }

  const setupXco = await confirm({ message: 'Configure ExtremeCloud Orchestrator (XCO)?', default: false });
  if (setupXco) {
    console.log(chalk.dim('  XCO is your on-premises fabric orchestrator. Provide the management IP/hostname.\n'));
    domainEnv['XCO_HOST'] = await input({
      message: 'XCO host (IP or hostname, e.g. 10.1.1.1):',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    });
    domainEnv['XCO_USERNAME'] = await input({ message: 'XCO admin username:' });
    domainEnv['XCO_PASSWORD'] = await password({ message: 'XCO admin password:' });
  }

  // ── Step 4: Admin account ────────────────────────────────────────────────
  console.log('\n' + chalk.bold('Step 4 of 5 — Admin Account\n'));

  const adminEmail = await input({
    message: 'Admin email:',
    validate: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Enter a valid email address',
  });

  const adminPassword = await password({
    message: 'Admin password (min 8 chars):',
    validate: (v: string) => v.length >= 8 || 'Password must be at least 8 characters',
  });

  const confirmPass = await password({ message: 'Confirm password:' });
  if (adminPassword !== confirmPass) {
    printError('Passwords do not match. Run `bex init` again.');
    process.exit(1);
  }

  // ── Step 5: Generate config ───────────────────────────────────────────────
  console.log('\n' + chalk.bold('Step 5 of 5 — Generating configuration\n'));

  const skillRegistryToken = await input({
    message: 'Skill registry auth token (leave blank if registry is open):',
    default: '',
  });

  const spinner = ora('Generating secrets...').start();
  const jwtSecret = randomBytes(32).toString('hex');
  const vaultKey = randomBytes(32).toString('hex');
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
    VAULT_ENCRYPTION_KEY: vaultKey,
    CREDENTIAL_VAULT_KEY: vaultKey,
    LLM_PROVIDER: llmProvider,
    OPENAI_API_KEY: llmProvider === 'openai' ? llmApiKey : '',
    ANTHROPIC_API_KEY: llmProvider === 'anthropic' ? llmApiKey : '',
    AZURE_OPENAI_API_KEY: llmProvider === 'azure' ? llmApiKey : '',
    OLLAMA_BASE_URL: llmProvider === 'ollama' ? ollamaBaseUrl : '',
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
    BEX_ADMIN_PASSWORD: adminPassword,
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
  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch('http://localhost:4000/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEmail, adminPassword, llmProvider, llmApiKey, llmModel, channel,
        ...(ollamaBaseUrl && { ollamaBaseUrl }),
      }),
    });
    const json = (await res.json()) as { ok: boolean; data?: { adminToken?: string }; error?: unknown };
    if (res.status === 409) {
      setupSpinner.info('Platform already configured — admin account exists');
    } else if (json.ok) {
      setupSpinner.succeed('Admin account created');
      if (json.data?.adminToken) writeEnv({ BEX_ADMIN_TOKEN: json.data.adminToken });
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

  await waitForService('http://localhost:3000', 'Dashboard', 60_000);

  // ── Pull domain skills from registry (fast path) ──────────────────────────
  const { default: fetch } = await import('node-fetch');

  // Get a live JWT by logging in with the admin credentials we just created
  let registryAuthHeader: Record<string, string> = {};
  try {
    const loginRes = await fetch('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    const loginJson = (await loginRes.json()) as { ok: boolean; data?: { token?: string } };
    if (loginJson.ok && loginJson.data?.token) {
      registryAuthHeader = { Authorization: `Bearer ${loginJson.data.token}` };
    }
  } catch { /* proceed without auth — install will fail gracefully */ }

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
