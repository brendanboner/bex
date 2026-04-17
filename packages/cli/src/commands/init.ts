import { input, password, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { printBanner, printSuccess, printError, printWarning, findProjectRoot, writeEnv, waitForService, composeCommand, isDockerRunning } from '../utils.js';

const LLM_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  azure: ['gpt-4o', 'gpt-4-turbo'],
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
        console.log('\n' + chalk.dim('Run `bforge start` to start the platform.'));
        return;
      }
    }
  } catch {
    printError('Could not locate project root. Run bforge from inside the Forge directory.');
    process.exit(1);
  }

  const root = findProjectRoot();

  console.log(chalk.bold('Step 1 of 4: LLM Provider\n'));

  const llmProvider = await select({
    message: 'LLM provider:',
    choices: [
      { name: 'OpenAI (GPT-4o)', value: 'openai' },
      { name: 'Anthropic (Claude)', value: 'anthropic' },
      { name: 'Azure OpenAI', value: 'azure' },
    ],
  });

  const llmApiKey = await password({
    message: `${llmProvider} API key:`,
    validate: (v: string) => v.length > 10 || 'API key must be at least 10 characters',
  });

  await validateLlmKey(llmProvider, llmApiKey);

  const modelChoices = (LLM_MODELS[llmProvider] ?? ['gpt-4o']).map((m) => ({ name: m, value: m }));
  const llmModel = await select({
    message: 'Default model:',
    choices: modelChoices,
  });

  console.log('\n' + chalk.bold('Step 2 of 4: Interface Channel\n'));

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
    channelEnv['TELEGRAM_APPROVAL_CHAT_ID'] = await input({ message: 'Approval Chat ID:' });
  } else if (channel === 'teams') {
    channelEnv['TEAMS_WEBHOOK_URL'] = await input({ message: 'Teams Incoming Webhook URL:' });
  } else if (channel === 'whatsapp') {
    channelEnv['TWILIO_ACCOUNT_SID'] = await input({ message: 'Twilio Account SID:' });
    channelEnv['TWILIO_AUTH_TOKEN'] = await password({ message: 'Twilio Auth Token:' });
    channelEnv['TWILIO_WHATSAPP_FROM'] = await input({ message: 'WhatsApp From number (e.g. whatsapp:+14155238886):' });
    channelEnv['WHATSAPP_APPROVAL_TO'] = await input({ message: 'Approval destination number:' });
  }

  console.log('\n' + chalk.bold('Step 3 of 4: Admin Account\n'));

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
    printError('Passwords do not match. Run `bforge init` again.');
    process.exit(1);
  }

  console.log('\n' + chalk.bold('Step 4 of 4: Generating configuration\n'));

  const spinner = ora('Generating secrets...').start();
  const jwtSecret = randomBytes(32).toString('hex');
  const vaultKey = randomBytes(32).toString('hex');
  const pgPassword = randomBytes(16).toString('hex');
  spinner.succeed('Secrets generated');

  const envVars: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: `postgresql://forge:${pgPassword}@localhost:5432/forge?schema=public`,
    POSTGRES_PASSWORD: pgPassword,
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: jwtSecret,
    VAULT_ENCRYPTION_KEY: vaultKey,
    CREDENTIAL_VAULT_KEY: vaultKey,
    LLM_PROVIDER: llmProvider,
    OPENAI_API_KEY: llmProvider === 'openai' ? llmApiKey : '',
    ANTHROPIC_API_KEY: llmProvider === 'anthropic' ? llmApiKey : '',
    AZURE_OPENAI_API_KEY: llmProvider === 'azure' ? llmApiKey : '',
    LLM_MODEL: llmModel,
    PORT: '4000',
    DASHBOARD_PORT: '3000',
    KNOWLEDGE_DIR: './knowledge',
    REGISTRY_URL: '',
    LOG_LEVEL: 'info',
    CORS_ORIGIN: 'http://localhost:3000',
    RATE_LIMIT_MAX: '100',
    ...channelEnv,
    // Store admin credentials for setup API call
    FORGE_ADMIN_EMAIL: adminEmail,
    FORGE_ADMIN_PASSWORD: adminPassword,
    FORGE_LLM_PROVIDER: llmProvider,
    FORGE_LLM_API_KEY: llmApiKey,
    FORGE_LLM_MODEL: llmModel,
    FORGE_CHANNEL: channel,
  };

  writeEnv(envVars);
  printSuccess('.env written');

  const shouldStart = await confirm({
    message: 'Start the platform now?',
    default: true,
  });

  if (!shouldStart) {
    console.log('\n' + chalk.dim('Run `bforge start` when ready.'));
    return;
  }

  if (!isDockerRunning()) {
    printError('Docker is not running. Please start Docker and run `bforge start`.');
    process.exit(1);
  }

  console.log('');
  const startSpinner = ora('Starting services...').start();
  const result = composeCommand(['up', '-d', '--build'], root);
  if (result.status !== 0) {
    startSpinner.fail('Docker Compose failed to start services');
    process.exit(1);
  }
  startSpinner.succeed('Services started');

  console.log('');
  const apiReady = await waitForService('http://localhost:4000/health', 'API Gateway', 90_000);
  if (!apiReady) {
    printWarning('API Gateway did not start in time. Check logs with: bforge logs api-gateway');
    return;
  }

  // Run database migrations
  const migrateSpinner = ora('Running database migrations...').start();
  const migrateResult = composeCommand(['exec', 'api-gateway', 'node', 'scripts/init-db.sh'], root);
  if (migrateResult.status !== 0) {
    // Try direct
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('bash', [`${root}/scripts/init-db.sh`], { stdio: 'pipe', env: { ...process.env, ...envVars } });
    if (r.status !== 0) {
      migrateSpinner.warn('Migration script not found — run `npx prisma migrate deploy` manually');
    } else {
      migrateSpinner.succeed('Migrations applied');
    }
  } else {
    migrateSpinner.succeed('Migrations applied');
  }

  // Bootstrap admin via setup API
  const setupSpinner = ora('Creating admin account...').start();
  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch('http://localhost:4000/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEmail,
        adminPassword,
        llmProvider,
        llmApiKey,
        llmModel,
        channel,
      }),
    });

    const json = (await res.json()) as { ok: boolean; data?: { adminToken?: string }; error?: { message?: string } };

    if (res.status === 409) {
      setupSpinner.info('Platform already configured');
    } else if (json.ok) {
      setupSpinner.succeed('Admin account created');
      // Store admin token in .env for convenience
      if (json.data?.adminToken) {
        writeEnv({ FORGE_ADMIN_TOKEN: json.data.adminToken });
      }
    } else {
      setupSpinner.warn(`Setup warning: ${json.error?.message ?? 'unknown'}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setupSpinner.warn(`Could not call setup API: ${message}`);
  }

  await waitForService('http://localhost:3000', 'Dashboard', 60_000);

  console.log('');
  console.log(chalk.bold.cyan('╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║') + chalk.bold.green('  ✓ Forge is running!                                ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + chalk.white(`  Dashboard:  http://localhost:3000                  `) + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + chalk.white(`  API:        http://localhost:4000                  `) + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + chalk.dim(`  Login:      ${adminEmail.padEnd(36)}`) + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════╝'));
  console.log('');
}
