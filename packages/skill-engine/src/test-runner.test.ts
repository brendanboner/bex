import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// vi.mock is hoisted — 'ai' module will be mocked before any imports resolve
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

// Mock model builder so tests don't need real API keys
vi.mock('./model.js', () => ({
  buildModel: vi.fn().mockReturnValue({}),
}));

import { generateObject } from 'ai';
import { SkillTestRunner } from './test-runner.js';

const mockGenerateObject = vi.mocked(generateObject);

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const wellFormedTool = {
  name: 'get_devices',
  description: 'List all network devices managed by XCO',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximum number of results to return' },
      offset: { type: 'number', description: 'Pagination offset' },
    },
    required: [] as string[],
  },
};

const wellFormedSkill = {
  id: 'skill-well-formed',
  name: 'XCO Network Skill',
  tools: [wellFormedTool],
  systemPrompt: 'You are a network operations assistant for Extreme XCO.',
};

const malformedTool = {
  name: 'bad_tool',
  // missing description field
  parameters: { type: 'object', properties: {} },
};

const malformedSkill = {
  id: 'skill-malformed',
  name: 'Malformed Skill',
  tools: [malformedTool],
  systemPrompt: null,
};

const toolWithRequiredParams = {
  name: 'create_vlan',
  description: 'Create a new VLAN on the fabric',
  parameters: {
    type: 'object',
    properties: {
      vlan_id: { type: 'number', description: 'VLAN ID (1-4094)' },
      name: { type: 'string', description: 'VLAN name' },
    },
    required: ['vlan_id', 'name'],
  },
};

// ─── Prisma mock ───────────────────────────────────────────────────────────────

const prismaMock = {
  skill: {
    findUnique: vi.fn(),
  },
} as unknown as PrismaClient;

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SkillTestRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes all cases for a well-formed skill when LLM returns valid inputs', async () => {
    vi.mocked(prismaMock.skill.findUnique).mockResolvedValue(wellFormedSkill);

    mockGenerateObject.mockResolvedValue({
      object: {
        cases: [
          { description: 'List devices with no filters', input: {}, expectedBehaviour: 'Returns all devices' },
          {
            description: 'List devices with a limit',
            input: { limit: 10 },
            expectedBehaviour: 'Returns at most 10 devices',
          },
        ],
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const runner = new SkillTestRunner(prismaMock);
    const report = await runner.run('skill-well-formed');

    expect(report.skillId).toBe('skill-well-formed');
    expect(report.skillName).toBe('XCO Network Skill');
    expect(report.cases).toHaveLength(2);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.generatedAt).toBeTruthy();
  });

  it('fails immediately for a malformed tool (missing description)', async () => {
    vi.mocked(prismaMock.skill.findUnique).mockResolvedValue(malformedSkill);

    const runner = new SkillTestRunner(prismaMock);
    const report = await runner.run('skill-malformed');

    // The malformed tool should produce one failure without calling the LLM
    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(0);

    const failedCase = report.cases[0];
    expect(failedCase).toBeDefined();
    expect(failedCase?.pass).toBe(false);
    expect(failedCase?.message).toContain('well-formed');
  });

  it('marks a case as failed when the LLM-generated input is missing a required parameter', async () => {
    const skillWithRequired = {
      id: 'skill-required',
      name: 'VLAN Skill',
      tools: [toolWithRequiredParams],
      systemPrompt: null,
    };

    vi.mocked(prismaMock.skill.findUnique).mockResolvedValue(skillWithRequired);

    mockGenerateObject.mockResolvedValue({
      object: {
        cases: [
          // Missing required "name" parameter
          {
            description: 'Create VLAN without name',
            input: { vlan_id: 100 },
            expectedBehaviour: 'Should fail validation',
          },
          // Correct input
          {
            description: 'Create VLAN with all required params',
            input: { vlan_id: 200, name: 'management' },
            expectedBehaviour: 'Creates the VLAN',
          },
        ],
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const runner = new SkillTestRunner(prismaMock);
    const report = await runner.run('skill-required');

    expect(report.cases).toHaveLength(2);
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(1);

    const failed = report.cases.find((c) => !c.pass);
    expect(failed?.message).toContain('"name"');
  });

  it('marks case as failed when LLM generateObject throws', async () => {
    vi.mocked(prismaMock.skill.findUnique).mockResolvedValue(wellFormedSkill);
    mockGenerateObject.mockRejectedValue(new Error('LLM rate limit exceeded'));

    const runner = new SkillTestRunner(prismaMock);
    const report = await runner.run('skill-well-formed');

    expect(report.failed).toBe(1);
    expect(report.cases[0]?.message).toContain('LLM rate limit exceeded');
  });

  it('throws when skill is not found', async () => {
    vi.mocked(prismaMock.skill.findUnique).mockResolvedValue(null);

    const runner = new SkillTestRunner(prismaMock);
    await expect(runner.run('nonexistent')).rejects.toThrow('Skill not found: nonexistent');
  });

  it('returns an empty report for a skill with no tools', async () => {
    vi.mocked(prismaMock.skill.findUnique).mockResolvedValue({
      id: 'skill-empty',
      name: 'Empty Skill',
      tools: [],
      systemPrompt: null,
    });

    const runner = new SkillTestRunner(prismaMock);
    const report = await runner.run('skill-empty');

    expect(report.cases).toHaveLength(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });
});
