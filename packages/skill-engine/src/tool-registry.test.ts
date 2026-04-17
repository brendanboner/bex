import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from './tool-registry.js';
import type { ToolDefinition } from './tool-registry.js';

vi.mock('./model.js', () => ({
  buildModel: vi.fn().mockReturnValue({}),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

function makePrisma() {
  return {
    dynamicTool: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };
}

const httpTool: ToolDefinition = {
  name: 'get_devices',
  description: 'Fetches the list of network devices',
  parameters: { deviceId: { type: 'string', description: 'Device ID' } },
  handlerType: 'http_call',
  config: { url: 'https://api.example.com/devices' },
  domain: 'networking.extreme-xco',
};

const sshTool: ToolDefinition = {
  name: 'run_ssh_command',
  description: 'Execute a command over SSH',
  parameters: { command: { type: 'string', description: 'Shell command' } },
  handlerType: 'ssh_exec',
  config: { targetId: 'sw-01' },
  domain: 'networking.extreme-xco',
};

const cloudTool: ToolDefinition = {
  name: 'list_ec2_instances',
  description: 'List EC2 instances in AWS',
  parameters: { region: { type: 'string', description: 'AWS region' } },
  handlerType: 'http_call',
  config: { url: 'https://ec2.amazonaws.com' },
  domain: 'cloud.aws',
};

describe('ToolRegistry', () => {
  it('load() loads enabled tools from DB and returns the count', async () => {
    const prisma = makePrisma();
    prisma.dynamicTool.findMany.mockResolvedValue([
      {
        id: 't1',
        name: httpTool.name,
        description: httpTool.description,
        parameters: httpTool.parameters,
        handlerType: httpTool.handlerType,
        config: httpTool.config,
        domain: httpTool.domain,
        skillId: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 't2',
        name: sshTool.name,
        description: sshTool.description,
        parameters: sshTool.parameters,
        handlerType: sshTool.handlerType,
        config: sshTool.config,
        domain: sshTool.domain,
        skillId: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const registry = new ToolRegistry(prisma as never);
    const count = await registry.load();

    expect(count).toBe(2);
    expect(registry.has(httpTool.name)).toBe(true);
    expect(registry.has(sshTool.name)).toBe(true);
  });

  it('register() persists to DB and adds tool to in-memory map', async () => {
    const prisma = makePrisma();
    prisma.dynamicTool.upsert.mockResolvedValue({});

    const registry = new ToolRegistry(prisma as never);
    await registry.register(httpTool);

    expect(prisma.dynamicTool.upsert).toHaveBeenCalledOnce();
    expect(registry.has(httpTool.name)).toBe(true);
  });

  it('getByDomain() returns only tools matching the given domain', async () => {
    const prisma = makePrisma();
    prisma.dynamicTool.upsert.mockResolvedValue({});

    const registry = new ToolRegistry(prisma as never);
    await registry.register(httpTool);
    await registry.register(sshTool);
    await registry.register(cloudTool);

    const networkingTools = registry.getByDomain('networking.extreme-xco');
    const cloudTools = registry.getByDomain('cloud.aws');

    expect(Object.keys(networkingTools)).toHaveLength(2);
    expect(networkingTools).toHaveProperty(httpTool.name);
    expect(networkingTools).toHaveProperty(sshTool.name);
    expect(Object.keys(cloudTools)).toHaveLength(1);
    expect(cloudTools).toHaveProperty(cloudTool.name);
  });

  it('getAll() returns all registered tools', async () => {
    const prisma = makePrisma();
    prisma.dynamicTool.upsert.mockResolvedValue({});

    const registry = new ToolRegistry(prisma as never);
    await registry.register(httpTool);
    await registry.register(cloudTool);

    const all = registry.getAll();

    expect(Object.keys(all)).toHaveLength(2);
    expect(all).toHaveProperty(httpTool.name);
    expect(all).toHaveProperty(cloudTool.name);
  });
});
