import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { AgentCharterSchema, UpdateAgentCharterSchema } from '@bclaw/shared';
import { ok, err, ErrorCodes } from '@bclaw/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

export async function charterRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const db = prisma as AnyPrisma;

  // GET /agents/:id/charter
  app.get('/agents/:id/charter', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await db.agent.findUnique({
      where: { id },
      include: { charter: true },
    });
    if (!agent) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent not found'));
    if (!agent.charter) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent has no charter'));
    return reply.send(ok(agent.charter));
  });

  // PUT /agents/:id/charter — create or replace charter
  app.put('/agents/:id/charter', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parse = AgentCharterSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, parse.error.message));

    const agent = await db.agent.findUnique({ where: { id }, select: { id: true, charterId: true } });
    if (!agent) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent not found'));

    try {
      if (agent.charterId) {
        const charter = await db.agentCharter.update({
          where: { id: agent.charterId },
          data: {
            mandate: parse.data.mandate,
            posture: parse.data.posture,
            bearing: parse.data.bearing,
            verbosity: parse.data.verbosity,
            conductBoundaries: parse.data.conductBoundaries,
            escalationTriggers: parse.data.escalationTriggers,
            ...(parse.data.scopeLimits !== undefined ? { scopeLimits: parse.data.scopeLimits } : {}),
          },
        });
        return reply.send(ok(charter));
      } else {
        const charter = await db.agentCharter.create({
          data: {
            mandate: parse.data.mandate,
            posture: parse.data.posture,
            bearing: parse.data.bearing,
            verbosity: parse.data.verbosity,
            conductBoundaries: parse.data.conductBoundaries,
            escalationTriggers: parse.data.escalationTriggers,
            ...(parse.data.scopeLimits !== undefined ? { scopeLimits: parse.data.scopeLimits } : {}),
          },
        });
        await db.agent.update({ where: { id }, data: { charterId: charter.id } });
        return reply.status(201).send(ok(charter));
      }
    } catch (e) {
      return reply.status(500).send(err(ErrorCodes.INTERNAL, e instanceof Error ? e.message : String(e)));
    }
  });

  // PATCH /agents/:id/charter — partial update
  app.patch('/agents/:id/charter', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parse = UpdateAgentCharterSchema.safeParse(request.body);
    if (!parse.success) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, parse.error.message));

    const agent = await db.agent.findUnique({ where: { id }, select: { id: true, charterId: true } });
    if (!agent?.charterId) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Agent has no charter to update'));

    const charter = await db.agentCharter.update({
      where: { id: agent.charterId },
      data: {
        ...(parse.data.mandate !== undefined ? { mandate: parse.data.mandate } : {}),
        ...(parse.data.posture !== undefined ? { posture: parse.data.posture } : {}),
        ...(parse.data.bearing !== undefined ? { bearing: parse.data.bearing } : {}),
        ...(parse.data.verbosity !== undefined ? { verbosity: parse.data.verbosity } : {}),
        ...(parse.data.conductBoundaries !== undefined ? { conductBoundaries: parse.data.conductBoundaries } : {}),
        ...(parse.data.escalationTriggers !== undefined ? { escalationTriggers: parse.data.escalationTriggers } : {}),
        ...(parse.data.scopeLimits !== undefined ? { scopeLimits: parse.data.scopeLimits } : {}),
      },
    });
    return reply.send(ok(charter));
  });
}
