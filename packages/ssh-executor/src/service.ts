import type { PrismaClient } from '@prisma/client';
import type { CredentialVaultService } from '@bclaw/credential-vault';
import { sshExec } from './client.js';
import type { SshExecResult } from './client.js';
import type { CoreTool } from 'ai';
import { z } from 'zod';

export class SshExecutorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly vault: CredentialVaultService,
  ) {}

  /**
   * Executes a command on the target device, resolving credentials from the vault.
   * The raw credential values are never returned to the caller.
   */
  async exec(targetId: string, command: string): Promise<SshExecResult> {
    const target = await this.prisma.target.findUnique({ where: { id: targetId } });
    if (!target) throw new Error(`Target not found: ${targetId}`);

    if (!target.credentialId) {
      throw new Error(`Target "${target.name}" has no credential configured`);
    }

    // Resolve credentials from vault — never exposed outside this service
    const creds = await this.vault.resolve(target.credentialId, ['ssh:exec']);

    const sshCreds = creds as {
      username: string;
      password?: string;
      privateKey?: string;
      passphrase?: string;
    };

    if (!sshCreds.username) {
      throw new Error(`Credential for target "${target.name}" is missing "username"`);
    }

    return sshExec(target.hostname, target.sshPort, sshCreds, command);
  }

  /**
   * Verifies SSH connectivity to a target.
   * Returns true and updates target.sshVerified on success.
   */
  async verify(targetId: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.exec(targetId, 'echo openclaw-verify');
      const success = result.stdout.trim() === 'openclaw-verify' && result.exitCode === 0;
      await this.prisma.target.update({
        where: { id: targetId },
        data: { sshVerified: success },
      });
      return { success, message: success ? 'SSH connectivity verified' : `Unexpected output: ${result.stdout}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.prisma.target.update({
        where: { id: targetId },
        data: { sshVerified: false },
      });
      return { success: false, message: msg };
    }
  }
}

/**
 * Creates an LLM-callable tool that executes SSH commands on a named target.
 * The agent specifies a target name; the tool resolves the ID and credentials internally.
 */
export function createSshTool(
  sshService: SshExecutorService,
  prisma: PrismaClient,
): CoreTool {
  return {
    parameters: z.object({
      target_name: z.string().describe('Name of the target device to SSH into'),
      command: z.string().describe('Shell command to execute on the remote device'),
    }),
    description: 'Execute a shell command on a managed network device via SSH. Use this for device configuration, status checks, and diagnostics.',
    execute: async (args: { target_name: string; command: string }) => {
      const target = await prisma.target.findUnique({ where: { name: args.target_name } });
      if (!target) {
        return { error: `No target found with name: ${args.target_name}` };
      }
      try {
        const result = await sshService.exec(target.id, args.command);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          success: result.exitCode === 0,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  } satisfies CoreTool;
}
