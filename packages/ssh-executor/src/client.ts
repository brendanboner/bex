import { Client as SshClient } from 'ssh2';
import type { ConnectConfig } from 'ssh2';

export type SshCredentials = {
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 1_048_576; // 1 MB

/**
 * Executes a single command on a remote host over SSH.
 * Credentials are passed in directly — the caller is responsible for
 * resolving them from the credential vault.
 */
export function sshExec(
  host: string,
  port: number,
  credentials: SshCredentials,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SshExecResult> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.destroy();
        reject(new Error(`SSH exec timed out after ${timeoutMs}ms: ${host}:${port}`));
      }
    }, timeoutMs);

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.end();
      if (err) {
        reject(err);
      } else {
        resolve({ stdout, stderr, exitCode });
      }
    };

    const config: ConnectConfig = {
      host,
      port,
      username: credentials.username,
      readyTimeout: timeoutMs,
    };

    if (credentials.privateKey) {
      config.privateKey = credentials.privateKey;
      if (credentials.passphrase) {
        config.passphrase = credentials.passphrase;
      }
    } else if (credentials.password) {
      config.password = credentials.password;
    } else {
      reject(new Error('SSH credentials must include either password or privateKey'));
      return;
    }

    client.on('ready', () => {
      client.exec(command, (err, stream) => {
        if (err) return done(err);

        let stdoutLen = 0;
        let stderrLen = 0;

        stream.on('data', (chunk: Buffer) => {
          stdoutLen += chunk.length;
          if (stdoutLen > DEFAULT_MAX_BUFFER) return done(new Error('SSH stdout buffer exceeded'));
          stdout += chunk.toString('utf8');
        });

        stream.stderr.on('data', (chunk: Buffer) => {
          stderrLen += chunk.length;
          if (stderrLen > DEFAULT_MAX_BUFFER) return done(new Error('SSH stderr buffer exceeded'));
          stderr += chunk.toString('utf8');
        });

        stream.on('close', (code: number | null) => {
          exitCode = code ?? 0;
          done();
        });

        stream.on('error', (err: Error) => done(err));
      });
    });

    client.on('error', (err) => done(err));
    client.connect(config);
  });
}
