import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { ok, err, ErrorCodes } from '@bclaw/shared';
import { ToolRegistry } from '@bclaw/skill-engine';
import type { ToolDefinition } from '@bclaw/skill-engine';

const RegisterToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.record(z.unknown()),
  handlerType: z.enum(['http_call', 'skill_invoke', 'agent_delegate', 'ssh_exec']),
  config: z.record(z.unknown()),
  domain: z.string().optional(),
  skillId: z.string().optional(),
});

const GenerateToolSchema = z.object({
  intent: z.string().min(1),
  apiSpec: z.string().optional(),
});

export async function toolRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const registry = new ToolRegistry(prisma);

  // GET /tools — list all dynamic tools
  app.get('/tools', async (_request, reply) => {
    const tools = await prisma.dynamicTool.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        description: true,
        handlerType: true,
        domain: true,
        skillId: true,
        enabled: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(tools));
  });

  // GET /tools/:name — get tool details
  app.get<{ Params: { name: string } }>('/tools/:name', async (request, reply) => {
    const tool = await prisma.dynamicTool.findUnique({
      where: { name: request.params.name },
    });
    if (!tool) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Tool not found'));
    return reply.send(ok(tool));
  });

  // POST /tools — register a new tool
  app.post<{ Body: unknown }>('/tools', async (request, reply) => {
    const parsed = RegisterToolSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const definition: ToolDefinition = parsed.data as ToolDefinition;
    await registry.register(definition);
    const saved = await prisma.dynamicTool.findUnique({ where: { name: definition.name } });
    return reply.status(201).send(ok(saved));
  });

  // POST /tools/generate — generate tool from intent
  app.post<{ Body: unknown }>('/tools/generate', async (request, reply) => {
    const parsed = GenerateToolSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    const { intent, apiSpec } = parsed.data;
    const definition = await registry.generate(intent, apiSpec);
    return reply.send(ok(definition));
  });

  // DELETE /tools/:name — disable a tool
  app.delete<{ Params: { name: string } }>('/tools/:name', async (request, reply) => {
    const tool = await prisma.dynamicTool.findUnique({
      where: { name: request.params.name },
      select: { id: true },
    });
    if (!tool) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Tool not found'));
    await registry.disable(request.params.name);
    return reply.send(ok({ disabled: true }));
  });
}
