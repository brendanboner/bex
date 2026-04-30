export function validateEnv(): void {
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // At least one LLM API key must be configured
  const llmKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AZURE_OPENAI_API_KEY'];
  const hasLlmKey = llmKeys.some((k) => process.env[k]);
  if (!hasLlmKey) {
    throw new Error(
      `No LLM API key configured. Set one of: ${llmKeys.join(', ')} ` +
      `in .env or via credential vault (system.openai_api_key, system.anthropic_api_key, system.azure_openai_api_key). ` +
      `Run 'bex init' to set up LLM configuration.`,
    );
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (jwtSecret === 'change-me-in-production' || jwtSecret === 'dev-secret') {
    console.warn('[bclaw] WARNING: JWT_SECRET is set to a default/insecure value. Change before deploying to production.');
  }

  if (!process.env['KNOWLEDGE_DIR']) {
    console.info('[bclaw] KNOWLEDGE_DIR not set — defaulting to ./knowledge');
  }
}
