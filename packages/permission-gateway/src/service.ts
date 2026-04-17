import { PrismaClient } from '@prisma/client';

import type { ApprovalChannel, ApprovalPayload } from '@bclaw/shared';
import { ErrorCodes } from '@bclaw/shared';

import type { NotificationAdapter } from './adapters.js';
import { TelegramAdapter, TeamsAdapter, WhatsAppAdapter } from './adapters.js';

const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class PermissionGatewayService {
  private readonly adapters: Map<ApprovalChannel, NotificationAdapter>;

  constructor(private readonly prisma: PrismaClient) {
    this.adapters = new Map<ApprovalChannel, NotificationAdapter>([
      ['telegram', new TelegramAdapter() as NotificationAdapter],
      ['teams', new TeamsAdapter() as NotificationAdapter],
      ['whatsapp', new WhatsAppAdapter() as NotificationAdapter],
    ]);
  }

  /**
   * Raises an approval request for a given agent request.
   * Sends notification via the configured channel and stores the pending approval.
   */
  async requestApproval(
    requestId: string,
    agentName: string,
    userId: string,
    reason: string,
    channel: ApprovalChannel,
  ): Promise<{ approvalId: string }> {
    const expiresAt = new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS);

    const payload: ApprovalPayload = {
      requestId,
      agentName,
      userId,
      reason,
      channel,
      expiresAt,
    };

    const adapter = this.adapters.get(channel);
    const channelRef = adapter ? await adapter.sendApprovalRequest(payload) : null;

    const approval = await this.prisma.approvalRequest.create({
      data: {
        requestId,
        reason,
        status: 'PENDING',
        requestedBy: userId,
        channel,
        channelRef,
        expiresAt,
      },
      select: { id: true },
    });

    return { approvalId: approval.id };
  }

  /**
   * Records an approval decision (called by the HTTP callback endpoint).
   */
  async recordDecision(
    requestId: string,
    decision: 'APPROVED' | 'DENIED',
  ): Promise<void> {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { requestId },
    });

    if (!approval) {
      throw Object.assign(new Error('Approval request not found'), { code: ErrorCodes.NOT_FOUND });
    }

    if (approval.status !== 'PENDING') {
      throw Object.assign(new Error('Approval request is no longer pending'), {
        code: ErrorCodes.CONFLICT,
      });
    }

    if (approval.expiresAt < new Date()) {
      await this.expire(requestId);
      throw Object.assign(new Error('Approval request has expired'), {
        code: ErrorCodes.APPROVAL_EXPIRED,
      });
    }

    await this.prisma.approvalRequest.update({
      where: { requestId },
      data: { status: decision, respondedAt: new Date() },
    });

    // Update the notification (e.g. edit the Telegram message)
    if (approval.channelRef) {
      const adapter = this.adapters.get(approval.channel as ApprovalChannel);
      await adapter?.updateApprovalStatus(approval.channelRef, decision);
    }
  }

  /**
   * Polls the DB for the status of an approval (used by orchestrator to block execution).
   */
  async pollStatus(
    requestId: string,
  ): Promise<'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED'> {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { requestId },
      select: { status: true, expiresAt: true },
    });

    if (!approval) return 'EXPIRED';

    if (approval.status === 'PENDING' && approval.expiresAt < new Date()) {
      await this.expire(requestId);
      return 'EXPIRED';
    }

    return approval.status;
  }

  private async expire(requestId: string): Promise<void> {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { requestId },
      select: { channelRef: true, channel: true },
    });

    await this.prisma.approvalRequest.update({
      where: { requestId },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });

    if (approval?.channelRef) {
      const adapter = this.adapters.get(approval.channel as ApprovalChannel);
      await adapter?.updateApprovalStatus(approval.channelRef, 'EXPIRED');
    }
  }
}
