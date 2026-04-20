import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

export interface ConstraintCheck {
  sourceDomain: string;
  targetDomain: string;
  compatible: 'FULL' | 'PARTIAL' | 'NONE';
  notes?: string;
  conditions?: Record<string, unknown>;
}

export class DomainConstraintRegistry {
  constructor(private prisma: PrismaClient) {}

  async register(constraint: {
    sourceDomain: string;
    targetDomain: string;
    compatible: 'FULL' | 'PARTIAL' | 'NONE';
    notes?: string;
    conditions?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.domainConstraint.upsert({
      where: {
        sourceDomain_targetDomain: {
          sourceDomain: constraint.sourceDomain,
          targetDomain: constraint.targetDomain,
        },
      },
      update: {
        compatible: constraint.compatible,
        ...(constraint.notes !== undefined && { notes: constraint.notes }),
        ...(constraint.conditions !== undefined && {
          conditions: constraint.conditions as Prisma.JsonObject,
        }),
      },
      create: {
        sourceDomain: constraint.sourceDomain,
        targetDomain: constraint.targetDomain,
        compatible: constraint.compatible,
        ...(constraint.notes !== undefined && { notes: constraint.notes }),
        ...(constraint.conditions !== undefined && {
          conditions: constraint.conditions as Prisma.JsonObject,
        }),
      },
    });
  }

  async check(sourceDomain: string, targetDomain: string): Promise<ConstraintCheck> {
    const constraint = await this.prisma.domainConstraint.findUnique({
      where: {
        sourceDomain_targetDomain: { sourceDomain, targetDomain },
      },
    });

    if (!constraint) {
      return { sourceDomain, targetDomain, compatible: 'FULL' };
    }

    return {
      sourceDomain: constraint.sourceDomain,
      targetDomain: constraint.targetDomain,
      compatible: constraint.compatible,
      ...(constraint.notes != null && { notes: constraint.notes }),
      ...(constraint.conditions != null && {
        conditions: constraint.conditions as Record<string, unknown>,
      }),
    };
  }

  async list(domain?: string): Promise<ConstraintCheck[]> {
    const constraints = await this.prisma.domainConstraint.findMany({
      ...(domain !== undefined && {
        where: { OR: [{ sourceDomain: domain }, { targetDomain: domain }] },
      }),
    });

    return constraints.map((c) => ({
      sourceDomain: c.sourceDomain,
      targetDomain: c.targetDomain,
      compatible: c.compatible,
      ...(c.notes != null && { notes: c.notes }),
      ...(c.conditions != null && { conditions: c.conditions as Record<string, unknown> }),
    }));
  }

  async checkAll(domains: string[]): Promise<ConstraintCheck[]> {
    const results: ConstraintCheck[] = [];
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        results.push(await this.check(domains[i]!, domains[j]!));
      }
    }
    return results;
  }
}
