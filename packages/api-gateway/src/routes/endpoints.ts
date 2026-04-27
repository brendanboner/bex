/**
 * Endpoint routes in the api-gateway.
 * Handles SSH verify + exec for endpoints that have sshEnabled = true.
 * Basic CRUD is handled by dashboard-api (/admin/endpoints).
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { CredentialVaultService } from '@bex/credential-vault';
import { sshExec } from '@bex/ssh-executor';
import { ok, err, ErrorCodes } from '@bex/shared';

export async function endpointRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  vault: CredentialVaultService,
): Promise<void> {
  // POST /endpoints/:id/verify-ssh — test SSH connectivity for an endpoint
  app.post<{ Params: { id: string } }>('/endpoints/:id/verify-ssh', async (request, reply) => {
    const endpoint = await prisma.endpoint.findUnique({ where: { id: request.params.id } });
    if (!endpoint) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Endpoint not found'));
    if (!endpoint.sshEnabled || !endpoint.hostname) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'SSH is not enabled for this endpoint'));
    }
    if (!endpoint.credentialId) {
      return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'No credential configured for SSH'));
    }

    try {
      const creds = await vault.resolve(endpoint.credentialId, ['ssh:exec']);
      const username = String(creds['username'] ?? '');
      const password = String(creds['password'] ?? '');
      const privateKey = creds['privateKey'] !== undefined ? String(creds['privateKey']) : undefined;

      if (!username) {
        return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'Credential missing "username"'));
      }

      const result = await sshExec(
        endpoint.hostname,
        endpoint.sshPort,
        {
          username,
          ...(password ? { password } : {}),
          ...(privateKey ? { privateKey } : {}),
        },
        'echo bex-verify',
      );

      await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: { sshVerified: result.exitCode === 0 },
      });

      return reply.send(ok({
        success: result.exitCode === 0,
        message: result.exitCode === 0 ? 'SSH connection verified' : `SSH failed: ${result.stderr}`,
      }));
    } catch (e) {
      await prisma.endpoint.update({ where: { id: endpoint.id }, data: { sshVerified: false } });
      return reply.status(500).send(err(ErrorCodes.INTERNAL, (e as Error).message));
    }
  });
}
