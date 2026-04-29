/**
 * GET /platforms — returns status of each supported platform (XIQ, XCO).
 *
 * Response shape:
 * {
 *   platforms: Array<{
 *     id: string;
 *     label: string;
 *     configured: boolean;
 *     credentialId: string | null;
 *     skillCount: number;
 *     playbooksCount: number;
 *     agentId: string | null;
 *     agentName: string | null;
 *     status: 'active' | 'not_configured' | 'partial';
 *   }>
 * }
 */
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { ok } from '@bex/shared';

const PLATFORM_DEFS = [
  {
    id: 'xiq',
    label: 'ExtremeCloud IQ',
    domainPrefix: 'extremecloudiq',
    credentialKeywords: ['xiq', 'extremecloudiq', 'extremecloud iq'],
    agentKeywords: ['extremecloud iq', 'extremecloudiq', 'xiq'],
  },
  {
    id: 'xco',
    label: 'ExtremeCloud Orchestrator',
    domainPrefix: 'networking.extreme-xco',
    credentialKeywords: ['xco', 'extreme-xco', 'orchestrator', 'efa'],
    agentKeywords: ['xco', 'orchestrator', 'efa', 'extreme-xco'],
  },
] as const;

export async function platformRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  app.get('/platforms', async (_request, reply) => {
    const platforms = await Promise.all(
      PLATFORM_DEFS.map(async (def) => {
        // 1. Credential: look for a credential whose name/description matches platform keywords
        const credential = await prisma.credential.findFirst({
          where: {
            OR: def.credentialKeywords.map((kw) => ({
              OR: [
                { name: { contains: kw, mode: 'insensitive' as const } },
                { description: { contains: kw, mode: 'insensitive' as const } },
              ],
            })),
          },
          select: { id: true },
        });

        // 2. Skills: count skills with this domain prefix
        const skillCount = await prisma.skill.count({
          where: { domain: { startsWith: def.domainPrefix }, status: 'PUBLISHED' },
        });

        // 3. Domain knowledge playbooks count
        const domainKnowledge = await prisma.domainKnowledge.findFirst({
          where: { domain: def.domainPrefix.split('.')[0] },
          select: { playbooks: true },
        });
        const playbooksCount = Array.isArray(domainKnowledge?.playbooks)
          ? (domainKnowledge.playbooks as unknown[]).length
          : 0;

        // 4. Agent
        const agent = await prisma.agent.findFirst({
          where: {
            status: 'ACTIVE',
            OR: def.agentKeywords.map((kw) => ({
              OR: [
                { name: { contains: kw, mode: 'insensitive' as const } },
                { description: { contains: kw, mode: 'insensitive' as const } },
              ],
            })),
          },
          select: { id: true, name: true },
        });

        const configured = credential !== null;
        const status =
          !configured ? 'not_configured'
          : skillCount === 0 ? 'partial'
          : 'active';

        return {
          id: def.id,
          label: def.label,
          configured,
          credentialId: credential?.id ?? null,
          skillCount,
          playbooksCount,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          status,
        };
      }),
    );

    return reply.send(ok({ platforms }));
  });

  // POST /platforms/:id/provision — manually trigger provisioning for a platform
  app.post<{ Params: { id: string } }>('/platforms/:id/provision', async (request, reply) => {
    const { id } = request.params;
    const def = PLATFORM_DEFS.find((p) => p.id === id);
    if (!def) {
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: `Unknown platform: ${id}` } });
    }

    void (async () => {
      try {
        const { provision } = await import('../provision.js');
        const { CredentialVaultService } = await import('@bex/credential-vault');
        const vault = new CredentialVaultService(prisma);
        await provision(prisma, vault);
        console.info(`[platforms] Manual provision triggered for ${id}`);
      } catch (e) {
        console.warn(`[platforms] Provision failed for ${id}:`, (e as Error).message);
      }
    })();

    return reply.status(202).send(ok({ message: `Provisioning triggered for ${def.label}` }));
  });
}
