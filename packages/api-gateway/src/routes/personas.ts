import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PersonaFactory, PersonaSpawner } from '@bclaw/persona-factory';
import { GeneratePersonaSchema, SpawnPersonaSchema } from '@bclaw/shared';
import { ok, err, ErrorCodes } from '@bclaw/shared';

export async function personaRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // POST /personas/generate — generate persona from goal via LLM
  app.post('/personas/generate', async (request, reply) => {
    const parse = GeneratePersonaSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, parse.error.message));

    try {
      const factory = new PersonaFactory(prisma);
      const persona = await factory.generate({
        goal: parse.data.goal,
        ...(parse.data.domain !== undefined ? { domain: parse.data.domain } : {}),
        ...(parse.data.existingSkills !== undefined ? { existingSkills: parse.data.existingSkills } : {}),
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
    return reply.send(ok(personas));
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
      const agent = await spawner.spawnAgent(id, parse.data.ownerId, {
        ...(parse.data.name !== undefined ? { name: parse.data.name } : {}),
        ...(parse.data.llmProvider !== undefined ? { llmProvider: parse.data.llmProvider } : {}),
        ...(parse.data.llmModel !== undefined ? { llmModel: parse.data.llmModel } : {}),
      });
      return reply.status(201).send(ok(agent));
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
}
