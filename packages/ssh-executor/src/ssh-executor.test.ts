import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock ssh2 before importing the module under test
vi.mock('ssh2', () => {
  return {
    Client: class MockSshClient {
      private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

      on(event: string, handler: (...args: unknown[]) => void) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
        return this;
      }

      connect(_config: unknown) {
        // Simulate async ready event
        setTimeout(() => {
          this.handlers['ready']?.forEach((h) => h());
        }, 0);
        return this;
      }

      exec(_command: string, cb: (err: Error | null, stream: unknown) => void) {
        // Build a fake stream
        const streamHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        const stderrHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

        const stream = {
          on(event: string, handler: (...args: unknown[]) => void) {
            if (!streamHandlers[event]) streamHandlers[event] = [];
            streamHandlers[event].push(handler);
            return stream;
          },
          stderr: {
            on(event: string, handler: (...args: unknown[]) => void) {
              if (!stderrHandlers[event]) stderrHandlers[event] = [];
              stderrHandlers[event].push(handler);
              return stream.stderr;
            },
          },
          _emit(event: string, ...args: unknown[]) {
            streamHandlers[event]?.forEach((h) => h(...args));
          },
          _emitData(chunk: string) {
            streamHandlers['data']?.forEach((h) => h(Buffer.from(chunk)));
          },
        };

        cb(null, stream);

        // Simulate: send data then close
        setTimeout(() => {
          stream._emitData('bex-verify\n');
          stream._emit('close', 0);
        }, 0);

        return this;
      }

      end() { return this; }
      destroy() { return this; }
    },
  };
});

import { sshExec } from '../src/client.js';

describe('sshExec', () => {
  it('executes a command and returns stdout', async () => {
    const result = await sshExec(
      'localhost',
      22,
      { username: 'admin', password: 'secret' },
      'echo bex-verify',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bex-verify');
    expect(result.stderr).toBe('');
  });

  it('rejects when neither password nor privateKey is provided', async () => {
    await expect(
      sshExec('localhost', 22, { username: 'admin' }, 'echo hello'),
    ).rejects.toThrow('SSH credentials must include either password or privateKey');
  });
});

describe('SshExecutorService', () => {
  it('resolves target and credentials from DB then executes', async () => {
    const mockTarget = {
      id: 'target-1',
      name: 'xco-london',
      hostname: '10.0.0.1',
      sshPort: 22,
      credentialId: 'cred-1',
    };

    const mockVault = {
      resolve: vi.fn().mockResolvedValue({ username: 'admin', password: 'pass' }),
    };

    const mockPrisma = {
      target: {
        findUnique: vi.fn().mockResolvedValue(mockTarget),
        update: vi.fn().mockResolvedValue({ ...mockTarget, sshVerified: true }),
      },
    };

    const { SshExecutorService } = await import('../src/service.js');

    const service = new SshExecutorService(
      mockPrisma as never,
      mockVault as never,
    );

    const result = await service.exec('target-1', 'echo hello');
    expect(mockPrisma.target.findUnique).toHaveBeenCalledWith({ where: { id: 'target-1' } });
    expect(mockVault.resolve).toHaveBeenCalledWith('cred-1', ['ssh:exec']);
    expect(result.exitCode).toBe(0);
  });

  it('throws when target is not found', async () => {
    const mockPrisma = {
      target: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const { SshExecutorService } = await import('../src/service.js');
    const service = new SshExecutorService(mockPrisma as never, {} as never);
    await expect(service.exec('missing', 'ls')).rejects.toThrow('Target not found');
  });

  it('throws when target has no credentialId', async () => {
    const mockPrisma = {
      target: {
        findUnique: vi.fn().mockResolvedValue({ id: 't1', name: 'test', hostname: '1.2.3.4', sshPort: 22, credentialId: null }),
      },
    };
    const { SshExecutorService } = await import('../src/service.js');
    const service = new SshExecutorService(mockPrisma as never, {} as never);
    await expect(service.exec('t1', 'ls')).rejects.toThrow('no credential configured');
  });
});
