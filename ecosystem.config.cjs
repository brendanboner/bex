/**
 * PM2 ecosystem — BEX services
 * Start:   pm2 start ecosystem.config.cjs
 * Stop:    pm2 stop all
 * Restart: pm2 restart all
 * Logs:    pm2 logs
 * Status:  pm2 status
 */

const path = require('path');
const root  = __dirname;

// Load .env so we can read values into env blocks
require('dotenv').config({ path: path.join(root, '.env') });

const sharedEnv = {
  DATABASE_URL:         process.env.DATABASE_URL,
  REDIS_URL:            process.env.REDIS_URL,
  JWT_SECRET:           process.env.JWT_SECRET,
  CREDENTIAL_VAULT_KEY: process.env.CREDENTIAL_VAULT_KEY,
  OPENAI_API_KEY:       process.env.OPENAI_API_KEY   ?? '',
  ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY ?? '',
  CORS_ORIGIN:          process.env.CORS_ORIGIN      ?? 'http://localhost:3000',
  SKILL_REGISTRY_URL:   process.env.SKILL_REGISTRY_URL ?? 'http://localhost:5050',
  SKILL_REGISTRY_TOKEN: process.env.SKILL_REGISTRY_TOKEN ?? 'bex-registry-dev',
  KNOWLEDGE_BASE_DIR:   process.env.KNOWLEDGE_BASE_DIR ?? './knowledge',
  KNOWLEDGE_DIR:        process.env.KNOWLEDGE_DIR ?? './knowledge',
};

module.exports = {
  apps: [
    {
      name: 'bex-registry',
      script: path.join(root, 'packages/skill-registry/dist/server.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: path.join(root, 'logs/skill-registry.error.log'),
      out_file:   path.join(root, 'logs/skill-registry.log'),
      env: {
        PORT: '5050',
        DATA_DIR: path.join(root, 'packages/skill-registry/data'),
        REGISTRY_AUTH_TOKEN: process.env.SKILL_REGISTRY_TOKEN ?? 'bex-registry-dev',
      },
    },
    {
      name: 'bex-api',
      script: path.join(root, 'packages/api-gateway/dist/server.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: path.join(root, 'logs/api-gateway.error.log'),
      out_file:   path.join(root, 'logs/api-gateway.log'),
      env: { ...sharedEnv },
    },
    {
      name: 'bex-admin',
      script: path.join(root, 'packages/dashboard-api/dist/server.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: path.join(root, 'logs/admin-api.error.log'),
      out_file:   path.join(root, 'logs/admin-api.log'),
      env: {
        PORT: '4001',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL:    process.env.REDIS_URL,
        JWT_SECRET:   process.env.JWT_SECRET,
        CORS_ORIGIN:  process.env.CORS_ORIGIN ?? 'http://localhost:3000',
      },
    },
    {
      name: 'bex-worker',
      script: path.join(root, 'packages/scheduler/dist/worker.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: path.join(root, 'logs/worker.error.log'),
      out_file:   path.join(root, 'logs/worker.log'),
      env: { ...sharedEnv },
    },
    {
      name: 'bex-dashboard',
      script: path.join(root, 'apps/dashboard/.next/standalone/apps/dashboard/server.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: path.join(root, 'logs/dashboard.error.log'),
      out_file:   path.join(root, 'logs/dashboard.log'),
      env: {
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
        NEXT_PUBLIC_API_URL:       'http://localhost:4000',
        NEXT_PUBLIC_ADMIN_API_URL: 'http://localhost:4001',
      },
    },
    {
      name: 'bex-telegram',
      script: path.join(root, 'integrations/telegram/dist/bot.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: path.join(root, 'logs/telegram-bot.error.log'),
      out_file:   path.join(root, 'logs/telegram-bot.log'),
      env: {
        TELEGRAM_BOT_TOKEN:         process.env.TELEGRAM_BOT_TOKEN ?? '',
        TELEGRAM_DEFAULT_AGENT_ID:  process.env.TELEGRAM_DEFAULT_AGENT_ID ?? '',
        BEX_BOT_API_KEY:            process.env.BEX_BOT_API_KEY ?? process.env.BEX_ADMIN_TOKEN ?? '',
        API_GATEWAY_URL:            'http://localhost:4000',
        DATABASE_URL:               process.env.DATABASE_URL,
        REDIS_URL:                  process.env.REDIS_URL,
        JWT_SECRET:                 process.env.JWT_SECRET,
      },
    },
  ],
};
