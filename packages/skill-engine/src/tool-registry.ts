import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { CoreTool } from 'ai';
import { z } from 'zod';

import { buildModel } from './model.js';
import { generateObject } from 'ai';

export interface ToolRegistryServices {
  vault?: {
    proxyRequest(config: {
      credentialId: string;
      method: string;
      url: string;
      body?: unknown;
      headers?: Record<string, string>;
      injection: { type: 'bearer' } | { type: 'header'; key: string } | { type: 'query'; key: string } | { type: 'basic' };
    }, permissions: string[]): Promise<{ status: number; body: unknown }>;
  };
  sshExecutor?: {
    exec(targetId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  agentMesh?: {
    delegateTo(agentId: string, payload: Record<string, unknown>): Promise<{ status: string; result?: unknown }>;
  };
}

export interface ToolDefinition {

  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handlerType: 'http_call' | 'public_http_call' | 'skill_invoke' | 'agent_delegate' | 'ssh_exec';
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

function buildCoreTool(definition: ToolDefinition, services: ToolRegistryServices): CoreTool {
  const props = (definition.parameters as { properties?: Record<string, JsonSchemaProperty> }).properties ?? (definition.parameters as Record<string, JsonSchemaProperty>);
  const schema = jsonSchemaToZod(props);

  return {
    description: definition.description,
    parameters: schema as z.ZodTypeAny,
    execute: async (args: Record<string, unknown>): Promise<unknown> => {
      switch (definition.handlerType) {
        case 'public_http_call': {
          // Direct HTTP call to a public/free API — no credentials required
          const config = definition.config as {
            method: string;
            urlTemplate: string;
            responseField?: string; // optional dot-path to extract from response
          };
          const { fetch } = await import('undici');
          const url = config.urlTemplate.replace(/\{(\w+)\}/g, (_, k) => String(args[k] ?? ''));
          const method = (config.method ?? 'GET').toUpperCase();
          const fetchOpts: Parameters<typeof fetch>[1] = {
            method,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          };
          if (method !== 'GET' && method !== 'HEAD') {
            fetchOpts.body = JSON.stringify(args);
          }
          const resp = await fetch(url, fetchOpts);
          const body = await resp.json() as Record<string, unknown>;
          return body;
        }

        case 'http_call': {
          const config = definition.config as {
            credentialId: string;
            method: string;
            urlTemplate: string;
            injection?: { type: string; key?: string };
          };
          if (!services.vault) return { error: 'vault service not available' };
          const url = config.urlTemplate.replace(/\{(\w+)\}/g, (_, k) => String(args[k] ?? ''));
          const injection = (config.injection ?? { type: 'bearer' }) as
            | { type: 'bearer' }
            | { type: 'header'; key: string }
            | { type: 'query'; key: string }
            | { type: 'basic' };
          const result = await services.vault.proxyRequest(
            { credentialId: config.credentialId, method: config.method, url, body: args, injection },
            [],
          );
          return result.body;
        }

        case 'ssh_exec': {
          const config = definition.config as { targetId: string; commandTemplate: string };
          if (!services.sshExecutor) return { error: 'ssh executor service not available' };
          const command = config.commandTemplate.replace(/\{(\w+)\}/g, (_, k) => String(args[k] ?? ''));
          return services.sshExecutor.exec(config.targetId, command);
        }

        case 'agent_delegate': {
          const config = definition.config as { agentId: string };
          if (!services.agentMesh) return { error: 'agent mesh service not available' };
          return services.agentMesh.delegateTo(config.agentId, args);
        }

        case 'skill_invoke': {
          const config = definition.config as { endpoint: string; credentialId: string };
          if (!services.vault) return { error: 'vault service not available' };
          const result = await services.vault.proxyRequest(
            {
              credentialId: config.credentialId,
              method: 'POST',
              url: config.endpoint,
              body: args,
              injection: { type: 'bearer' },
            },
            [],
          );
          return result.body;
        }

        default:
          return { error: `Unknown handler type: ${definition.handlerType}` };
      }
    },
  } as CoreTool;
}

export class ToolRegistry {
  private tools = new Map<string, CoreTool>();
  private toolDomains = new Map<string, string>();

  constructor(private prisma: PrismaClient, private services: ToolRegistryServices = {}) {}

  async load(): Promise<number> {
    const rows = await this.prisma.dynamicTool.findMany({ where: { enabled: true } });
    for (const row of rows) {
      const def: ToolDefinition = {
        name: row.name,
        description: row.description,
        parameters: row.parameters as Record<string, unknown>,
        handlerType: row.handlerType as ToolDefinition['handlerType'],
        config: row.config as Record<string, unknown>,
        ...(row.domain != null ? { domain: row.domain } : {}),
        ...(row.skillId != null ? { skillId: row.skillId } : {}),
      };
      this.tools.set(row.name, buildCoreTool(def, this.services));
      if (row.domain != null) this.toolDomains.set(row.name, row.domain);
    }
    return rows.length;
  }

  async register(definition: ToolDefinition): Promise<void> {
    await this.prisma.dynamicTool.upsert({
      where: { name: definition.name },
      create: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as Prisma.InputJsonObject,
        handlerType: definition.handlerType,
        config: definition.config as Prisma.InputJsonObject,
        ...(definition.domain !== undefined ? { domain: definition.domain } : {}),
        ...(definition.skillId !== undefined ? { skillId: definition.skillId } : {}),
      },
      update: {
        description: definition.description,
        parameters: definition.parameters as Prisma.InputJsonObject,
        handlerType: definition.handlerType,
        config: definition.config as Prisma.InputJsonObject,
        ...(definition.domain !== undefined ? { domain: definition.domain } : {}),
      },
    });
    this.tools.set(definition.name, buildCoreTool(definition, this.services));
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
    await this.prisma.dynamicTool.update({ where: { name }, data: { enabled: false } });
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
        handlerType: z.enum(['http_call', 'public_http_call', 'skill_invoke', 'agent_delegate', 'ssh_exec']),
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
