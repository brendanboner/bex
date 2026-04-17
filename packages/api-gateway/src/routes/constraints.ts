import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { ok, err, ErrorCodes } from '@bclaw/shared';
import { DomainConstraintRegistry } from '@bclaw/agent-mesh';

const RegisterConstraintSchema = z.object({
  sourceDomain: z.string().min(1),
  targetDomain: z.string().min(1),
  compatible: z.enum(['FULL', 'PARTIAL', 'NONE']),
  notes: z.string().optional(),
  conditions: z.record(z.unknown()).optional(),
});

export async function constraintRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const registry = new DomainConstraintRegistry(prisma);

  // GET /constraints — list all constraints
  app.get('/constraints', async (_request, reply) => {
    const constraints = await registry.list();
    return reply.send(ok(constraints));
  });

  // GET /constraints/:domain1/:domain2 — check compatibility
  app.get<{ Params: { domain1: string; domain2: string } }>(
    '/constraints/:domain1/:domain2',
    async (request, reply) => {
      const { domain1, domain2 } = request.params;
      const result = await registry.check(domain1, domain2);
      return reply.send(ok(result));
    },
  );

  // POST /constraints — register constraint
  app.post<{ Body: unknown }>('/constraints', async (request, reply) => {
    const parsed = RegisterConstraintSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }
    await registry.register({
      sourceDomain: parsed.data.sourceDomain,
      targetDomain: parsed.data.targetDomain,
      compatible: parsed.data.compatible,
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.conditions !== undefined ? { conditions: parsed.data.conditions } : {}),
    });
    return reply.status(201).send(ok({ registered: true }));
  });

  // DELETE /constraints/:domain1/:domain2 — remove constraint
  app.delete<{ Params: { domain1: string; domain2: string } }>(
    '/constraints/:domain1/:domain2',
    async (request, reply) => {
      const { domain1, domain2 } = request.params;
      try {
        await prisma.domainConstraint.delete({
          where: { sourceDomain_targetDomain: { sourceDomain: domain1, targetDomain: domain2 } },
        });
        return reply.send(ok({ deleted: true }));
      } catch {
        return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Constraint not found'));
      }
    },
  );
}
