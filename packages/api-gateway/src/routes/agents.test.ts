import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// We test that routes respond with the correct envelope shape
// by mounting them against an in-memory Fastify instance.

const mockAgent = {
  id: 'agent-1',
  name: 'Test Agent',
  description: null,
  status: 'DRAFT',
  llmProvider: 'openai',
  llmModel: 'gpt-4o',
  createdAt: new Date().toISOString(),
};

// Minimal Prisma mock
const prismaMock = {
  agent: {
    findMany: vi.fn().mockResolvedValue([mockAgent]),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(mockAgent),
    update: vi.fn().mockResolvedValue(mockAgent),
    delete: vi.fn().mockResolvedValue(mockAgent),
  },
  user: {
    findUnique: vi.fn().mockResolvedValue({ isSystemUser: true }),
  },
  agentSkill: { create: vi.fn() },
};

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: 'test-secret' });

  // Add auth hook
  // lgtm[js/missing-rate-limiting] — test-only app; rate limiting is not required in unit tests
  app.addHook('onRequest', async (req) => {
    await req.jwtVerify();
  });

  app.decorate('requireSystemUser', async () => {});

  const { agentRoutes } = await import('./agents.js');
  // @ts-expect-error partial prisma mock
  await agentRoutes(app, prismaMock);
  return app;
}

function makeToken(app: Awaited<ReturnType<typeof buildTestApp>>) {
  return app.jwt.sign({ sub: 'test-user' });
}

describe('api-gateway /agents routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    app = await buildTestApp();
    vi.clearAllMocks();
  });

  it('GET /agents returns ok:true with an array', async () => {
    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/agents',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST /agents with valid body returns 201', async () => {
    prismaMock.agent.create.mockResolvedValueOnce(mockAgent);
    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Agent', llmProvider: 'openai', llmModel: 'gpt-4o' }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('POST /agents with missing name returns 400', async () => {
    const token = makeToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ llmProvider: 'openai', llmModel: 'gpt-4o' }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('GET /agents/:id returns 404 for unknown id', async () => {
    prismaMock.agent.findFirst.mockResolvedValueOnce(null);
    const token = makeToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/agents/does-not-exist',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(401);
  });
});
