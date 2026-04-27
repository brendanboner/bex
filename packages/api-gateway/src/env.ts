export function validateEnv(): void {
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (jwtSecret === 'change-me-in-production' || jwtSecret === 'dev-secret') {
    console.warn('[bclaw] WARNING: JWT_SECRET is set to a default/insecure value. Change before deploying to production.');
  }

  if (!process.env['KNOWLEDGE_DIR']) {
    console.info('[bclaw] KNOWLEDGE_DIR not set — defaulting to ./knowledge');
  }
}
