import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ─── Hoist mocks before any imports ─────────────────────────────────────────

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => () => ({ modelId: 'gpt-4o' }),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => () => ({ modelId: 'claude-3-5-sonnet' }),
}));

vi.mock('@ai-sdk/azure', () => ({
  createAzure: () => () => ({ modelId: 'azure-gpt4o' }),
}));

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Synthesised answer from coordinator',
    toolCalls: [],
    toolResults: [],
    steps: [],
    usage: { promptTokens: 10, completionTokens: 20 },
  }),
  generateObject: vi.fn().mockResolvedValue({
    object: {
      goal: 'Compare XIQ and XCO topology data',
      steps: [
        {
          id: 'step-1',
          domain: 'networking.extreme-xiq',
          goal: 'Fetch XIQ topology data',
          requiredCapabilities: ['list-devices'],
          dependsOn: [],
        },
        {
          id: 'step-2',
          domain: 'networking.extreme-xco',
          goal: 'Fetch XCO fabric topology',
          requiredCapabilities: ['get-fabric-topology'],
          dependsOn: [],
        },
        {
          id: 'step-3',
          domain: 'synthesis',
          goal: 'Compare and synthesise XIQ + XCO data',
          requiredCapabilities: [],
          dependsOn: ['step-1', 'step-2'],
        },
      ],
      domainConstraints: [
        {
          sourceDomain: 'networking.extreme-xiq',
          targetDomain: 'networking.extreme-xco',
          compatible: 'PARTIAL',
          notes: 'XIQ and XCO use different device models',
        },
      ],
      estimatedParallelism: 2,
    },
  }),
}));

import { SessionManager } from './session-manager.js';
import { WorkflowPlanner } from './planner.js';
import { CoordinatorAgent } from './coordinator.js';
import { makeCheckConstraintTool } from './meta-tools.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseSession = {
  id: 'sess-abc123',
  userId: 'user-1',
  turns: [],
  agentRequestIds: [],
  status: 'RUNNING',
  channel: 'api',
  output: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

function makeMockPrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    coordinatorSession: {
      create: vi.fn().mockResolvedValue({ ...baseSession }),
      findUnique: vi.fn().mockResolvedValue({ ...baseSession }),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...baseSession,
        ...data,
      })),
      findMany: vi.fn().mockResolvedValue([{ ...baseSession }]),
    },
    skill: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    domainConstraint: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'dc-1',
        sourceDomain: 'networking.extreme-xiq',
        targetDomain: 'networking.extreme-xco',
        compatible: 'PARTIAL',
        notes: 'XIQ and XCO are partially compatible — different device model spaces',
        conditions: null,
      }),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SessionManager', () => {
  let prisma: PrismaClient;
  let manager: SessionManager;

  beforeEach(() => {
    prisma = makeMockPrisma();
    manager = new SessionManager(prisma);
  });

  it('create() creates a session with RUNNING status', async () => {
    const session = await manager.create('user-1', 'api');

    expect(session.id).toBe('sess-abc123');
    expect(session.userId).toBe('user-1');
    expect(session.status).toBe('RUNNING');
    expect(session.channel).toBe('api');
    expect(session.turns).toEqual([]);
    expect(
      (prisma.coordinatorSession.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({
      data: { userId: 'user-1', channel: 'api', status: 'RUNNING' },
    });
  });

  it('appendTurn() appends a turn to the session', async () => {
    const turn = {
      role: 'user' as const,
      content: 'Hello coordinator',
      timestamp: '2024-01-01T00:00:00.000Z',
    };

    await manager.appendTurn('sess-abc123', turn);

    const updateCall = (prisma.coordinatorSession.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall).toBeDefined();
    const updateArg = updateCall?.[0] as { where: { id: string }; data: { turns: unknown[] } };
    expect(updateArg.where.id).toBe('sess-abc123');
    expect(Array.isArray(updateArg.data.turns)).toBe(true);
    expect(updateArg.data.turns).toContainEqual(turn);
  });
});

describe('WorkflowPlanner', () => {
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('plan() with mocked LLM returns a WorkflowPlan with steps', async () => {
    const planner = new WorkflowPlanner('openai', 'gpt-4o');
    const plan = await planner.plan('Compare XIQ and XCO topology data', ['list-devices', 'get-fabric-topology']);

    expect(plan.goal).toBe('Compare XIQ and XCO topology data');
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedParallelism).toBeGreaterThanOrEqual(1);

    const firstStep = plan.steps[0];
    expect(firstStep).toBeDefined();
    expect(typeof firstStep!.id).toBe('string');
    expect(typeof firstStep!.domain).toBe('string');
    expect(Array.isArray(firstStep!.dependsOn)).toBe(true);
  });
});

describe('CoordinatorAgent', () => {
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  it('plan() returns a workflow plan with steps (mocked LLM)', async () => {
    const prisma = makeMockPrisma();
    const agent = new CoordinatorAgent(prisma, { llmProvider: 'openai', llmModel: 'gpt-4o' });

    const plan = await agent.plan('user-1', 'Compare XIQ and XCO topology data');

    expect(plan.goal).toBeDefined();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(typeof plan.estimatedParallelism).toBe('number');
  });
});

describe('makeCheckConstraintTool', () => {
  it('returns PARTIAL for a known domain pair', async () => {
    const prisma = makeMockPrisma();
    const tool = makeCheckConstraintTool(prisma);

    const execute = tool.execute as (args: {
      sourceDomain: string;
      targetDomain: string;
    }) => Promise<{ found: boolean; compatible: string; notes: string | null }>;

    const result = await execute({
      sourceDomain: 'networking.extreme-xiq',
      targetDomain: 'networking.extreme-xco',
    });

    expect(result.found).toBe(true);
    expect(result.compatible).toBe('PARTIAL');
    expect(result.notes).toContain('partially compatible');
  });
});
