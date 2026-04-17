import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { CreateCredentialSchema, ok, err, ErrorCodes } from '@bclaw/shared';
import { CredentialVaultService } from '@bclaw/credential-vault';

export async function credentialRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const vault = new CredentialVaultService(prisma);

  // GET /credentials
  app.get('/credentials', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;
    const list = await vault.list(undefined, userId);
    return reply.send(ok(list));
  });

  // POST /credentials
  app.post<{ Body: unknown }>('/credentials', async (request, reply) => {
    const parsed = CreateCredentialSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const userId = (request.user as { sub: string }).sub;
    const credential = await vault.create(parsed.data, userId);

    return reply.status(201).send(ok(credential));
  });

  // DELETE /credentials/:id
  app.delete<{ Params: { id: string } }>('/credentials/:id', async (request, reply) => {
    await vault.delete(request.params.id);
    return reply.status(204).send();
  });
}
