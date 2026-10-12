import type { PrismaClient } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoordinatorTurn = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
  toolResult?: unknown;
};

export type CoordinatorSession = {
  id: string;
  userId: string;
  turns: CoordinatorTurn[];
  agentRequestIds: string[];
  status: 'QUEUED' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  channel: string;
  output?: string;
  createdAt: Date;
  updatedAt: Date;
};

// ─── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, channel: string): Promise<CoordinatorSession> {
    const raw = await this.prisma.coordinatorSession.create({
      data: { userId, channel, status: 'RUNNING' },
    });
    return this.mapSession(raw);
  }

  async get(sessionId: string): Promise<CoordinatorSession | null> {
    const raw = await this.prisma.coordinatorSession.findUnique({
      where: { id: sessionId },
    });
    if (raw === null) return null;
    return this.mapSession(raw);
  }

  async appendTurn(sessionId: string, turn: CoordinatorTurn): Promise<void> {
    const session = await this.prisma.coordinatorSession.findUnique({
      where: { id: sessionId },
      select: { turns: true },
    });
    if (session === null) throw new Error(`Session ${sessionId} not found`);

    const existing = (session.turns as CoordinatorTurn[]) ?? [];
    const newTurns = [...existing, turn] as unknown as import('@prisma/client').Prisma.InputJsonValue[];
    await this.prisma.coordinatorSession.update({
      where: { id: sessionId },
      data: { turns: newTurns },
    });
  }

  async complete(sessionId: string, output: string): Promise<void> {
    await this.prisma.coordinatorSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED', output },
    });
  }

  async list(userId: string, limit: number = 20): Promise<CoordinatorSession[]> {
    const rows = await this.prisma.coordinatorSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.mapSession(r));
  }

  private mapSession(raw: {
    id: string;
    userId: string;
    turns: unknown;
    agentRequestIds: string[];
    status: string;
    channel: string;
    output?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CoordinatorSession {
    const turns = (Array.isArray(raw.turns) ? raw.turns : []) as CoordinatorTurn[];
    const base: CoordinatorSession = {
      id: raw.id,
      userId: raw.userId,
      turns,
      agentRequestIds: raw.agentRequestIds,
      status: raw.status as CoordinatorSession['status'],
      channel: raw.channel,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
    if (raw.output != null) {
      return { ...base, output: raw.output };
    }
    return base;
  }
}
