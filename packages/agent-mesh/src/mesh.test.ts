import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist mock references so they're available in vi.mock factories ──────────
const { mockQueueAdd, mockQueueClose } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: 'job-1' }),
  mockQueueClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockReturnValue({ status: 'ready' }),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
}));

import { DomainConstraintRegistry } from './constraint-registry.js';
import { CapabilityRouter } from './capability-router.js';
import { AgentMesh } from './mesh.js';

// ─── Prisma mock factory ──────────────────────────────────────────────────────
function makePrisma() {
  return {
    domainConstraint: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    agent: {
      findMany: vi.fn(),
    },
    meshEvent: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DomainConstraintRegistry', () => {
  it('check() returns FULL when no constraint exists', async () => {
    const prisma = makePrisma();
    prisma.domainConstraint.findUnique.mockResolvedValue(null);

    const registry = new DomainConstraintRegistry(prisma as never);
    const result = await registry.check('networking.xco', 'networking.xiq');

    expect(result.compatible).toBe('FULL');
    expect(result.sourceDomain).toBe('networking.xco');
    expect(result.targetDomain).toBe('networking.xiq');
  });

  it('check() returns the stored constraint', async () => {
    const prisma = makePrisma();
    prisma.domainConstraint.findUnique.mockResolvedValue({
      id: 'c1',
      sourceDomain: 'networking.xco',
      targetDomain: 'networking.xiq',
      compatible: 'PARTIAL',
      notes: 'requires bridging',
      conditions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const registry = new DomainConstraintRegistry(prisma as never);
    const result = await registry.check('networking.xco', 'networking.xiq');

    expect(result.compatible).toBe('PARTIAL');
    expect(result.notes).toBe('requires bridging');
  });

  it('register() calls prisma.domainConstraint.upsert', async () => {
    const prisma = makePrisma();
    prisma.domainConstraint.upsert.mockResolvedValue({});

    const registry = new DomainConstraintRegistry(prisma as never);
    await registry.register({
      sourceDomain: 'networking.xco',
      targetDomain: 'cloud.aws',
      compatible: 'NONE',
      notes: 'incompatible protocols',
    });

    expect(prisma.domainConstraint.upsert).toHaveBeenCalledOnce();
    const call = prisma.domainConstraint.upsert.mock.calls[0]![0] as {
      where: unknown;
      create: { compatible: string };
    };
    expect(call.create.compatible).toBe('NONE');
  });
});

describe('CapabilityRouter', () => {
  it('findAgents() filters agents by required capabilities', async () => {
    const prisma = makePrisma();
    prisma.agent.findMany.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'NetOps',
        permissions: ['ssh:exec'],
        agentSkills: [{ skill: { domain: 'networking.extreme-xco' } }],
      },
      {
        id: 'agent-2',
        name: 'CloudOps',
        permissions: ['read:network'],
        agentSkills: [{ skill: { domain: 'cloud.aws' } }],
      },
    ]);

    const router = new CapabilityRouter(prisma as never);
    const results = await router.findAgents(['networking.extreme-xco', 'ssh:exec']);

    expect(results).toHaveLength(1);
    expect(results[0]!.agentId).toBe('agent-1');
  });
});

describe('AgentMesh', () => {
  beforeEach(() => {
    mockQueueAdd.mockClear();
    mockQueueClose.mockClear();
  });

  it('canCompose() returns false when constraint is NONE', async () => {
    const prisma = makePrisma();
    prisma.domainConstraint.findUnique.mockResolvedValue({
      id: 'c1',
      sourceDomain: 'networking.xco',
      targetDomain: 'cloud.aws',
      compatible: 'NONE',
      notes: null,
      conditions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mesh = new AgentMesh(prisma as never, 'redis://localhost:6379');
    const result = await mesh.canCompose('networking.xco', 'cloud.aws');

    expect(result).toBe(false);
  });

  it('dispatch() creates a MeshEvent in DB before routing', async () => {
    const prisma = makePrisma();
    prisma.meshEvent.create.mockResolvedValue({
      id: 'evt-1',
      status: 'ROUTING',
      taskType: 'reboot-device',
      taskPayload: {},
      requiredCapabilities: ['networking.extreme-xco'],
      assignedAgentId: null,
      sessionId: null,
      result: null,
      errorMsg: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.meshEvent.update.mockResolvedValue({});
    // Return no capable agents so routing terminates cleanly
    prisma.agent.findMany.mockResolvedValue([]);

    const mesh = new AgentMesh(prisma as never, 'redis://localhost:6379');
    await mesh.dispatch({
      taskType: 'reboot-device',
      taskPayload: { targetId: 'sw-01' },
      requiredCapabilities: ['networking.extreme-xco'],
    });

    expect(prisma.meshEvent.create).toHaveBeenCalledOnce();
    const createCall = prisma.meshEvent.create.mock.calls[0]![0] as {
      data: { taskType: string; status: string };
    };
    expect(createCall.data.taskType).toBe('reboot-device');
    expect(createCall.data.status).toBe('ROUTING');
  });
});
