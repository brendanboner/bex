import { generateObject } from 'ai';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

import type { LlmProvider } from '@bex/shared';

import { buildModel } from './model.js';

// ─── Public types ──────────────────────────────────────────────────────────────

export type TestCase = {
  tool: string;
  description: string;
  input: Record<string, unknown>;
  expectedBehaviour: string;
};

export type TestResult = {
  tool: string;
  description: string;
  input: Record<string, unknown>;
  pass: boolean;
  message: string;
};

export type SkillTestReport = {
  skillId: string;
  skillName: string;
  passed: number;
  failed: number;
  skipped: number;
  cases: TestResult[];
  generatedAt: string;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  endpoint?: string;
};

/** Type guard: ensures the raw JSON value is a well-formed tool definition. */
function isToolDefinition(value: unknown): value is ToolDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['name'] === 'string' &&
    typeof obj['description'] === 'string' &&
    obj['description'].length > 0 &&
    typeof obj['parameters'] === 'object' &&
    obj['parameters'] !== null
  );
}

/**
 * Minimal JSON Schema dry-run validator.
 * Checks that all `required` parameters listed in the schema are present in the input.
 */
function validateInput(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
): { pass: boolean; message: string } {
  const required = schema['required'];
  if (Array.isArray(required)) {
    for (const field of required) {
      if (typeof field === 'string' && !(field in input)) {
        return { pass: false, message: `Missing required parameter: "${field}"` };
      }
    }
  }
  return { pass: true, message: 'Input conforms to parameter schema' };
}

// ─── SkillTestRunner ───────────────────────────────────────────────────────────

export class SkillTestRunner {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly llmProvider: LlmProvider = 'openai',
  ) {}

  async run(skillId: string): Promise<SkillTestReport> {
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      select: { id: true, name: true, tools: true, systemPrompt: true },
    });

    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    const rawTools: unknown[] = Array.isArray(skill.tools) ? (skill.tools as unknown[]) : [];
    const cases: TestResult[] = [];

    for (const rawTool of rawTools) {
      if (!isToolDefinition(rawTool)) {
        const toolName =
          typeof rawTool === 'object' && rawTool !== null && 'name' in rawTool
            ? String((rawTool as Record<string, unknown>)['name'])
            : 'unknown';

        cases.push({
          tool: toolName,
          description: 'Tool definition validation',
          input: {},
          pass: false,
          message:
            'Tool is not a well-formed tool definition (must have non-empty name, description, and parameters)',
        });
        continue;
      }

      // Generate test cases for this tool via LLM
      type GeneratedCase = {
        description: string;
        input: Record<string, unknown>;
        expectedBehaviour: string;
      };
      let generatedCases: GeneratedCase[];

      try {
        const model = buildModel(this.llmProvider);
        const { object } = await generateObject({
          model,
          system: 'You are a skill test generator for an enterprise agentic platform. Generate realistic, minimal test cases for the given tool.',
          prompt: [
            `Generate 2 test cases for this tool:`,
            `Name: ${rawTool.name}`,
            `Description: ${rawTool.description}`,
            `Parameters schema: ${JSON.stringify(rawTool.parameters, null, 2)}`,
          ].join('\n'),
          schema: z.object({
            cases: z.array(
              z.object({
                description: z.string(),
                input: z.record(z.unknown()),
                expectedBehaviour: z.string(),
              }),
            ),
          }),
        });
        generatedCases = object.cases;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        cases.push({
          tool: rawTool.name,
          description: 'LLM test case generation',
          input: {},
          pass: false,
          message: `Could not generate test cases (LLM error): ${message}`,
        });
        continue;
      }

      for (const tc of generatedCases) {
        const validation = validateInput(tc.input, rawTool.parameters);
        cases.push({
          tool: rawTool.name,
          description: tc.description,
          input: tc.input,
          pass: validation.pass,
          message: validation.message,
        });
      }
    }

    const passed = cases.filter((c) => c.pass).length;
    const failed = cases.filter((c) => !c.pass).length;

    return {
      skillId,
      skillName: skill.name,
      passed,
      failed,
      skipped: 0,
      cases,
      generatedAt: new Date().toISOString(),
    };
  }
}
