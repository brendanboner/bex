import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient, Persona, Agent } from '@prisma/client';

// Hoist mocks before any imports
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

vi.mock('@bex/skill-engine', () => ({
  buildModel: vi.fn().mockReturnValue({}),
}));

import { generateObject } from 'ai';
import { PersonaFactory } from './factory.js';
import { PersonaSpawner } from './spawner.js';

const mockGenerateObject = vi.mocked(generateObject);

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const llmPersonaObject = {
  name: 'XCO Drift Monitor',
  systemPrompt:
    'You are a network operations agent specializing in Extreme XCO fabric monitoring.',
  requiredSkills: ['networking.extreme-xco'],
  suggestedPermissions: ['read:network', 'ssh:exec'],
  schedule: '0 * * * *',
  tags: ['networking', 'monitoring', 'extreme-xco'],
  rationale: 'Periodic drift detection on XCO fabrics requires network read and SSH access.',
  instructions: '## Instructions\n\nCheck fabric health every hour.',
  context: '## Context\n\nXCO fabrics managed by this agent.',
  memory: '## Memory\n\nRecord observations after each run.',
};

const dbPersona: Persona = {
  id: 'persona-1',
  name: llmPersonaObject.name,
  goal: 'monitor Extreme XCO fabrics for drift',
  domain: 'networking.extreme-xco',
  systemPrompt: llmPersonaObject.systemPrompt,
  requiredSkills: llmPersonaObject.requiredSkills,
  suggestedPermissions: llmPersonaObject.suggestedPermissions,
  schedule: llmPersonaObject.schedule,
  tags: llmPersonaObject.tags,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  return {
    persona: {
      create: vi.fn().mockResolvedValue(dbPersona),
      findMany: vi.fn().mockResolvedValue([dbPersona]),
      findUnique: vi.fn().mockResolvedValue(dbPersona),
    },
    skill: {
      findMany: vi.fn().mockResolvedValue([{ id: 'skill-1' }]),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'skill-1' }]),
    agent: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    agentSkill: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    agentCharter: {
      create: vi.fn().mockResolvedValue({ id: 'charter-1' }),
    },
    scheduledJob: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

const mockAgent: Agent = {
  id: 'agent-1',
  name: 'XCO Drift Monitor',
  description: null,
  status: 'DRAFT',
  persona: { systemPrompt: dbPersona.systemPrompt },
  llmProvider: 'openai',
  llmModel: 'gpt-4o',
  llmConfig: {},
  permissions: dbPersona.suggestedPermissions,
  ownerId: 'user-1',
  personaId: 'persona-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('PersonaFactory', () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prismaMock = makePrismaMock();
    vi.clearAllMocks();
    mockGenerateObject.mockResolvedValue({
      object: llmPersonaObject,
    } as Awaited<ReturnType<typeof generateObject>>);
  });

  it('generate() returns a GeneratedPersona with all required fields', async () => {
    const factory = new PersonaFactory(prismaMock as unknown as PrismaClient);
    const result = await factory.generate({
      goal: 'monitor Extreme XCO fabrics for drift',
      domain: 'networking.extreme-xco',
    });

    expect(result.name).toBe(llmPersonaObject.name);
    expect(result.goal).toBe('monitor Extreme XCO fabrics for drift');
    expect(result.systemPrompt).toBeTruthy();
    expect(Array.isArray(result.requiredSkills)).toBe(true);
    expect(Array.isArray(result.suggestedPermissions)).toBe(true);
    expect(Array.isArray(result.tags)).toBe(true);
  });

  it('generate() for "monitor XCO fabrics" includes "networking" in tags or requiredSkills', async () => {
    const factory = new PersonaFactory(prismaMock as unknown as PrismaClient);
    const result = await factory.generate({
      goal: 'monitor Extreme XCO fabrics for drift',
      domain: 'networking.extreme-xco',
    });

    const hasNetworking =
      result.tags.some((t) => t.toLowerCase().includes('networking')) ||
      result.requiredSkills.some((s) => s.toLowerCase().includes('networking'));

    expect(hasNetworking).toBe(true);
  });

  it('list() returns all personas when no domain filter is given', async () => {
    const factory = new PersonaFactory(prismaMock as unknown as PrismaClient);
    const results = await factory.list();

    expect(prismaMock.persona.findMany).toHaveBeenCalledOnce();
    const callArg = prismaMock.persona.findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('where');
    expect(results).toHaveLength(1);
  });

  it('list(domain) passes domain filter to Prisma', async () => {
    const factory = new PersonaFactory(prismaMock as unknown as PrismaClient);
    await factory.list('networking.extreme-xco');

    expect(prismaMock.persona.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { domain: 'networking.extreme-xco' } }),
    );
  });
});

describe('PersonaSpawner', () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = makePrismaMock();
    prismaMock.agent.create.mockResolvedValue(mockAgent);
    prismaMock.agent.update.mockResolvedValue({ ...mockAgent, charterId: 'charter-1' });
  });

  it('spawnAgent() creates and returns an Agent with personaId set', async () => {
    const spawner = new PersonaSpawner(prismaMock as unknown as PrismaClient);
    const result = await spawner.spawnAgent('persona-1', 'user-1');

    expect(prismaMock.agent.create).toHaveBeenCalledOnce();
    const createCall = prismaMock.agent.create.mock.calls[0]?.[0] as { data: Partial<Agent> };
    expect(createCall.data.personaId).toBe('persona-1');
    expect(result.agent.id).toBe('agent-1');
  });

  it('spawnAgent() creates a ScheduledJob when persona has a schedule', async () => {
    const spawner = new PersonaSpawner(prismaMock as unknown as PrismaClient);
    // dbPersona.schedule = '0 * * * *'
    await spawner.spawnAgent('persona-1', 'user-1');

    expect(prismaMock.scheduledJob.create).toHaveBeenCalledOnce();
    const jobCall = prismaMock.scheduledJob.create.mock.calls[0]?.[0] as {
      data: { cronExpr: string };
    };
    expect(jobCall.data.cronExpr).toBe('0 * * * *');
  });

  it('spawnAgent() does NOT create ScheduledJob when persona has no schedule', async () => {
    const personaWithoutSchedule: Persona = { ...dbPersona, schedule: null };
    prismaMock.persona.findUnique.mockResolvedValue(personaWithoutSchedule);

    const spawner = new PersonaSpawner(prismaMock as unknown as PrismaClient);
    await spawner.spawnAgent('persona-1', 'user-1');

    expect(prismaMock.scheduledJob.create).not.toHaveBeenCalled();
  });
});
