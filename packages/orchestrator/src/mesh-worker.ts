import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { OrchestratorService } from './orchestrator.js';

interface MeshTaskJob {
  meshEventId: string;
  taskType: string;
  taskPayload: Record<string, unknown>;
  requiredCapabilities: string[];
  sessionId?: string;
  timeoutMs?: number;
}

export class MeshWorker {
  private workers: Worker[] = [];
  private redis: Redis;

  constructor(
    private prisma: PrismaClient,
    private orchestrator: OrchestratorService,
    redisUrl: string,
  ) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async startForAgent(agentId: string): Promise<void> {
    const queueName = `mesh-agent-${agentId}`;
    const worker = new Worker<MeshTaskJob>(
      queueName,
      async (job: Job<MeshTaskJob>) => {
        const { meshEventId, taskPayload } = job.data;
        try {
          await this.prisma.meshEvent.update({
            where: { id: meshEventId },
            data: { status: 'RUNNING' },
          });

          const input = (taskPayload['input'] as string | undefined) ?? JSON.stringify(taskPayload);

          const systemUser = await this.prisma.user.findFirst({
            where: { isSystemUser: true },
            select: { id: true },
          });
          const userId = systemUser?.id ?? 'system';

          const request = await this.prisma.agentRequest.create({
            data: {
              agentId,
              userId,
              status: 'QUEUED',
              input,
              channel: 'scheduler',
            },
          });

          const result = await this.orchestrator.execute({
            requestId: request.id,
            agentId,
            userId,
            input,
            channel: 'scheduler',
          });

          await this.prisma.meshEvent.update({
            where: { id: meshEventId },
            data: {
              status: 'COMPLETED',
              result: { output: result.output } as unknown as import('@prisma/client').Prisma.InputJsonValue,
            },
          });

          return result;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          await this.prisma.meshEvent.update({
            where: { id: meshEventId },
            data: { status: 'FAILED', errorMsg },
          });
          throw error;
        }
      },
      { connection: this.redis },
    );

    this.workers.push(worker);
  }

  async startForAllActiveAgents(): Promise<number> {
    const agents = await this.prisma.agent.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    await Promise.all(agents.map((a) => this.startForAgent(a.id)));
    return agents.length;
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.redis.quit();
  }
}
