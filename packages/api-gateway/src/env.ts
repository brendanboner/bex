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

  const hasLlm =
    process.env['OPENAI_API_KEY'] ||
    process.env['ANTHROPIC_API_KEY'] ||
    process.env['AZURE_OPENAI_API_KEY'];
  if (!hasLlm) {
    console.warn(
      '[bclaw] WARNING: No LLM API key configured (OPENAI_API_KEY / ANTHROPIC_API_KEY / AZURE_OPENAI_API_KEY). Agent execution will fail without one.',
    );
  }

  if (!process.env['KNOWLEDGE_DIR']) {
    console.info('[bclaw] KNOWLEDGE_DIR not set — defaulting to ./knowledge');
  }
}
