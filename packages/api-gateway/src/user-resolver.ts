import type { PrismaClient } from '@prisma/client';

/**
 * Resolves a JWT sub (externalId) to the DB User.id (cuid).
 * Returns null if the user is not found.
 */
export async function resolveUserId(prisma: PrismaClient, externalId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { externalId }, select: { id: true } });
  return user?.id ?? null;
}
