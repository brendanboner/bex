import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { CreateCredentialSchema, ok, err, ErrorCodes } from '@bex/shared';
import { CredentialVaultService } from '@bex/credential-vault';
import { resolveUserId } from '../user-resolver.js';

// Serialized re-provision: only one run at a time; if a run is in-flight when
// another credential is stored, we set a pending flag so a second run fires
// immediately after the first completes — ensuring no domain is ever dropped.
let reprovisionRunning = false;
let reprovisionPending = false;

async function runReprovision(prisma: PrismaClient): Promise<void> {
  if (reprovisionRunning) {
    reprovisionPending = true;
    return;
  }
  reprovisionRunning = true;
  try {
    do {
      reprovisionPending = false;
      const { provision } = await import('../provision.js');
      const { CredentialVaultService: CVS } = await import('@bex/credential-vault');
      const v = new CVS(prisma);
      await provision(prisma, v);
      console.info('[credentials] Re-provisioned after credential creation');
    } while (reprovisionPending);
  } catch (e) {
    console.warn('[credentials] Re-provision failed (non-fatal):', (e as Error).message);
  } finally {
    reprovisionRunning = false;
  }
}

export async function credentialRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const vault = new CredentialVaultService(prisma);

  // GET /credentials
  app.get('/credentials', async (request, reply) => {
    const externalId = (request.user as { sub: string }).sub;
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));
    const list = await vault.list(undefined, userId);
    return reply.send(ok(list));
  });

  // POST /credentials
  app.post<{ Body: unknown }>('/credentials', async (request, reply) => {
    const parsed = CreateCredentialSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Invalid input', parsed.error.issues));
    }

    const externalId = (request.user as { sub: string }).sub;
    const userId = await resolveUserId(prisma, externalId);
    if (!userId) return reply.status(401).send(err(ErrorCodes.UNAUTHORIZED, 'User not found'));
    const credential = await vault.create(parsed.data, userId);

    // Fire-and-forget serialized re-provision when XIQ or XCO credentials are added
    const credLower = (parsed.data.name + ' ' + (parsed.data.description ?? '')).toLowerCase();
    if (credLower.includes('xiq') || credLower.includes('extremecloudiq') || credLower.includes('xco') || credLower.includes('orchestrator')) {
      void runReprovision(prisma);
    }

    return reply.status(201).send(ok(credential));
  });

  // DELETE /credentials/:id
  app.delete<{ Params: { id: string } }>('/credentials/:id', async (request, reply) => {
    await vault.delete(request.params.id);
    return reply.status(204).send();
  });
}
