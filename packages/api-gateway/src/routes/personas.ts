import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PersonaFactory, PersonaSpawner } from '@bex/persona-factory';
import { GeneratePersonaSchema, SpawnPersonaSchema } from '@bex/shared';
import { ok, err, ErrorCodes } from '@bex/shared';
import { KnowledgeStore } from '@bex/knowledge-store';

export async function personaRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // POST /personas/generate — generate persona from goal via LLM
  app.post('/personas/generate', async (request, reply) => {
    const parse = GeneratePersonaSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, parse.error.message));

    try {
      const factory = new PersonaFactory(
        prisma,
        process.env['LLM_PROVIDER'] ?? 'openai',
        process.env['LLM_MODEL'] ?? 'gpt-4o',
      );
      const persona = await factory.generate({
        goal: parse.data.goal,
        ...(parse.data.domain !== undefined ? { domain: parse.data.domain } : {}),
        ...(parse.data.existingSkills !== undefined ? { existingSkills: parse.data.existingSkills } : {}),
        ...(parse.data.schedule !== undefined ? { schedule: parse.data.schedule } : {}),
      });
      return reply.send(ok(persona));
    } catch (e) {
      return reply.status(500).send(err(ErrorCodes.INTERNAL, e instanceof Error ? e.message : String(e)));
    }
  });

  // GET /personas — list personas, optionally filter by domain
  app.get('/personas', async (request, reply) => {
    const { domain } = request.query as { domain?: string };
    const factory = new PersonaFactory(prisma);
    const personas = await factory.list(domain);

    // Join spawned agent for each persona so the UI can show agent status
    const personasWithAgent = await Promise.all(
      personas.map(async (p) => {
        const agent = await prisma.agent.findFirst({
          where: { personaId: p.id },
          select: { id: true, name: true, status: true },
          orderBy: { createdAt: 'desc' },
        });
        return { ...p, spawnedAgent: agent ?? null };
      }),
    );

    return reply.send(ok(personasWithAgent));
  });

  // GET /personas/:id
  app.get('/personas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const factory = new PersonaFactory(prisma);
    const persona = await factory.get(id);
    if (!persona) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Persona not found'));
    return reply.send(ok(persona));
  });

  // POST /personas/:id/spawn — spawn an agent from a persona
  app.post('/personas/:id/spawn', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parse = SpawnPersonaSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, parse.error.message));

    try {
      const spawner = new PersonaSpawner(prisma);
      const externalId = (request.user as { sub: string }).sub;
      // Resolve DB user from JWT externalId — same pattern as agents route.
      const dbUser = await prisma.user.findUnique({ where: { externalId }, select: { id: true } });
      const resolvedOwnerId = parse.data.ownerId ?? dbUser?.id;
      if (!resolvedOwnerId) {
        return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));
      }
      const { agent, scheduledJob } = await spawner.spawnAgent(id, resolvedOwnerId, {
        ...(parse.data.name !== undefined ? { name: parse.data.name } : {}),
        ...(parse.data.llmProvider !== undefined ? { llmProvider: parse.data.llmProvider } : {}),
        ...(parse.data.llmModel !== undefined ? { llmModel: parse.data.llmModel } : {}),
      });
      return reply.status(201).send(ok({ agent, scheduledJob }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not found')) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, msg));
      return reply.status(500).send(err(ErrorCodes.INTERNAL, msg));
    }
  });

  // POST /personas/:id/respawn — ensure agent + scheduled job are alive; recreate if missing
  app.post('/personas/:id/respawn', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parse = SpawnPersonaSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, parse.error.message));

    try {
      const spawner = new PersonaSpawner(prisma);
      const externalId = (request.user as { sub: string }).sub;
      const dbUser = await prisma.user.findUnique({ where: { externalId }, select: { id: true } });
      const resolvedOwnerId = parse.data.ownerId ?? dbUser?.id;
      if (!resolvedOwnerId) {
        return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));
      }
      const result = await spawner.respawnAgent(id, resolvedOwnerId, {
        ...(parse.data.name !== undefined ? { name: parse.data.name } : {}),
        ...(parse.data.llmProvider !== undefined ? { llmProvider: parse.data.llmProvider } : {}),
        ...(parse.data.llmModel !== undefined ? { llmModel: parse.data.llmModel } : {}),
      });
      const status = result.action === 'created' ? 201 : 200;
      return reply.status(status).send(ok(result));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not found')) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, msg));
      return reply.status(500).send(err(ErrorCodes.INTERNAL, msg));
    }
  });

  // DELETE /personas/:id
  app.delete('/personas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.persona.delete({ where: { id } });
      return reply.send(ok({ deleted: true }));
    } catch {
      return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Persona not found'));
    }
  });

  // GET /personas/:id/memory — read memory for a persona's spawned agent
  app.get('/personas/:id/memory', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await prisma.agent.findFirst({
      where: { personaId: id },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!agent) {
      return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'No spawned agent found for this persona'));
    }
    const store = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');
    const entry = await store.read(`agent/${agent.id}`, 'memory').catch(() => null);
    return reply.send(ok({
      agentId: agent.id,
      agentName: agent.name,
      memory: entry?.content ?? null,
      updatedAt: entry?.updatedAt ?? null,
    }));
  });

  // PUT /personas/:id/memory — write/update memory for a persona's spawned agent
  app.put('/personas/:id/memory', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { content?: string };
    if (typeof body?.content !== 'string') {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'body.content is required'));
    }
    const agent = await prisma.agent.findFirst({
      where: { personaId: id },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!agent) {
      return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'No spawned agent found for this persona'));
    }
    const store = new KnowledgeStore(process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge');
    await store.write(`agent/${agent.id}`, 'memory', body.content);
    return reply.send(ok({ saved: true, agentId: agent.id }));
  });
}
