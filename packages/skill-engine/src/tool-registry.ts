import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { CoreTool } from 'ai';
import { z } from 'zod';

import { buildModel } from './model.js';
import { generateObject } from 'ai';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handlerType: 'http_call' | 'skill_invoke' | 'agent_delegate' | 'ssh_exec';
  config: Record<string, unknown>;
  domain?: string;
  skillId?: string;
}

type JsonSchemaProperty = { type: string; description?: string };

function jsonSchemaToZod(
  properties: Record<string, JsonSchemaProperty>,
): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    switch (prop.type) {
      case 'string':
        field = z.string();
        break;
      case 'number':
      case 'integer':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        field = z.array(z.unknown());
        break;
      case 'object':
        field = z.record(z.unknown());
        break;
      default:
        field = z.unknown();
    }
    if (prop.description) {
      field = field.describe(prop.description);
    }
    shape[key] = field;
  }
  return z.object(shape);
}

function buildCoreTool(definition: ToolDefinition): CoreTool {
  const props = definition.parameters as Record<string, JsonSchemaProperty>;
  const schema = jsonSchemaToZod(props);
  return {
    description: definition.description,
    parameters: schema as z.ZodTypeAny,
    execute: async (_args: unknown) => ({
      dispatched: true,
      handlerType: definition.handlerType,
      config: definition.config,
    }),
  } as CoreTool;
}

export class ToolRegistry {
  private tools = new Map<string, CoreTool>();
  private toolDomains = new Map<string, string>();

  constructor(private prisma: PrismaClient) {}

  async load(): Promise<number> {
    const rows = await this.prisma.dynamicTool.findMany({
      where: { enabled: true },
    });

    for (const row of rows) {
      const definition: ToolDefinition = {
        name: row.name,
        description: row.description,
        parameters: row.parameters as Record<string, unknown>,
        handlerType: row.handlerType as ToolDefinition['handlerType'],
        config: row.config as Record<string, unknown>,
        ...(row.domain != null && { domain: row.domain }),
        ...(row.skillId != null && { skillId: row.skillId }),
      };
      this.tools.set(row.name, buildCoreTool(definition));
      if (row.domain != null) {
        this.toolDomains.set(row.name, row.domain);
      }
    }

    return rows.length;
  }

  async register(definition: ToolDefinition): Promise<void> {
    await this.prisma.dynamicTool.upsert({
      where: { name: definition.name },
      update: {
        description: definition.description,
        parameters: definition.parameters as Prisma.InputJsonValue,
        handlerType: definition.handlerType,
        config: definition.config as Prisma.InputJsonValue,
        enabled: true,
        ...(definition.domain !== undefined && { domain: definition.domain }),
        ...(definition.skillId !== undefined && { skillId: definition.skillId }),
      },
      create: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as Prisma.InputJsonValue,
        handlerType: definition.handlerType,
        config: definition.config as Prisma.InputJsonValue,
        enabled: true,
        ...(definition.domain !== undefined && { domain: definition.domain }),
        ...(definition.skillId !== undefined && { skillId: definition.skillId }),
      },
    });

    this.tools.set(definition.name, buildCoreTool(definition));
    if (definition.domain !== undefined) {
      this.toolDomains.set(definition.name, definition.domain);
    }
  }

  getAll(): Record<string, CoreTool> {
    return Object.fromEntries(this.tools.entries());
  }

  getByDomain(domain: string): Record<string, CoreTool> {
    const result: Record<string, CoreTool> = {};
    for (const [name, tool] of this.tools.entries()) {
      if (this.toolDomains.get(name) === domain) {
        result[name] = tool;
      }
    }
    return result;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async disable(name: string): Promise<void> {
    await this.prisma.dynamicTool.update({
      where: { name },
      data: { enabled: false },
    });
    this.tools.delete(name);
    this.toolDomains.delete(name);
  }

  async generate(intent: string, apiSpec?: string): Promise<ToolDefinition> {
    const model = buildModel('openai');
    const { object } = await generateObject({
      model,
      schema: z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.record(z.unknown()),
        handlerType: z.enum(['http_call', 'skill_invoke', 'agent_delegate', 'ssh_exec']),
        config: z.record(z.unknown()),
        domain: z.string().optional(),
      }),
      system: `You are a tool architect for an enterprise agentic platform.
Generate a dynamic tool definition that can be used by AI agents.
The tool definition must have a clear name, description, parameters (JSON Schema format), handler type, and config.`,
      prompt: `Generate a tool for the following intent: ${intent}${apiSpec ? `\n\nAPI specification:\n${apiSpec}` : ''}`,
    });

    return object as ToolDefinition;
  }
}
