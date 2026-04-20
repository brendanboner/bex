import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { DomainConstraintRegistry } from './constraint-registry.js';
import { CapabilityRouter } from './capability-router.js';

export interface MeshTaskOptions {
  taskType: string;
  taskPayload: Record<string, unknown>;
  requiredCapabilities: string[];
  sessionId?: string;
  timeoutMs?: number;
}

export interface MeshTaskResult {
  meshEventId: string;
  assignedAgentId: string | null;
  status: 'COMPLETED' | 'FAILED' | 'NO_AGENT';
  result?: unknown;
  errorMsg?: string;
}

export class AgentMesh {
  private constraintRegistry: DomainConstraintRegistry;
  private capabilityRouter: CapabilityRouter;
  private redisConnection: Redis;

  constructor(private prisma: PrismaClient, redisUrl: string) {
    this.constraintRegistry = new DomainConstraintRegistry(prisma);
    this.capabilityRouter = new CapabilityRouter(prisma);
    this.redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async dispatch(options: MeshTaskOptions): Promise<MeshTaskResult> {
    const { taskType, taskPayload, requiredCapabilities, timeoutMs = 60000 } = options;
    const sessionId = options.sessionId;

    // Record task before any routing — required for observability
    const event = await this.prisma.meshEvent.create({
      data: {
        taskType,
        taskPayload: taskPayload as Prisma.JsonObject,
        requiredCapabilities,
        status: 'ROUTING',
        ...(sessionId !== undefined && { sessionId }),
      },
    });

    const agent = await this.capabilityRouter.findBestAgent(requiredCapabilities);
    if (!agent) {
      await this.prisma.meshEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', errorMsg: 'No capable agent found' },
      });
      return {
        meshEventId: event.id,
        assignedAgentId: null,
        status: 'NO_AGENT',
        errorMsg: 'No capable agent found',
      };
    }

    await this.prisma.meshEvent.update({
      where: { id: event.id },
      data: { assignedAgentId: agent.agentId, status: 'RUNNING' },
    });

    const queueName = `mesh-agent-${agent.agentId}`;
    const queue = new Queue(queueName, { connection: this.redisConnection });

    try {
      await queue.add('mesh-task', {
        meshEventId: event.id,
        taskType,
        taskPayload,
        requiredCapabilities,
        ...(sessionId !== undefined && { sessionId }),
        timeoutMs,
      });

      await this.prisma.meshEvent.update({
        where: { id: event.id },
        data: { status: 'COMPLETED' },
      });

      return { meshEventId: event.id, assignedAgentId: agent.agentId, status: 'COMPLETED' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.prisma.meshEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', errorMsg },
      });
      return { meshEventId: event.id, assignedAgentId: agent.agentId, status: 'FAILED', errorMsg };
    } finally {
      await queue.close();
    }
  }

  async delegateTo(
    agentId: string,
    taskPayload: Record<string, unknown>,
    sessionId?: string,
  ): Promise<MeshTaskResult> {
    const event = await this.prisma.meshEvent.create({
      data: {
        taskType: 'direct-delegation',
        taskPayload: taskPayload as Prisma.JsonObject,
        requiredCapabilities: [],
        assignedAgentId: agentId,
        status: 'RUNNING',
        ...(sessionId !== undefined && { sessionId }),
      },
    });

    const queueName = `mesh-agent-${agentId}`;
    const queue = new Queue(queueName, { connection: this.redisConnection });

    try {
      await queue.add('mesh-task', {
        meshEventId: event.id,
        taskType: 'direct-delegation',
        taskPayload,
        ...(sessionId !== undefined && { sessionId }),
      });

      await this.prisma.meshEvent.update({
        where: { id: event.id },
        data: { status: 'COMPLETED' },
      });

      return { meshEventId: event.id, assignedAgentId: agentId, status: 'COMPLETED' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.prisma.meshEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', errorMsg },
      });
      return { meshEventId: event.id, assignedAgentId: agentId, status: 'FAILED', errorMsg };
    } finally {
      await queue.close();
    }
  }

  async canCompose(domain1: string, domain2: string): Promise<boolean> {
    const constraint = await this.constraintRegistry.check(domain1, domain2);
    return constraint.compatible !== 'NONE';
  }

  async listEvents(sessionId?: string, limit = 50): Promise<Prisma.MeshEventGetPayload<object>[]> {
    return this.prisma.meshEvent.findMany({
      ...(sessionId !== undefined && { where: { sessionId } }),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
