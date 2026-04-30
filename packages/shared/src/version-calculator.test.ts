import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { getServiceVersions, getServiceVersion, getGlobalVersion, clearVersionCache } from './version-calculator.js';

// Mock execSync for git commands
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as any;

describe('version-calculator', () => {
  beforeEach(() => {
    clearVersionCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearVersionCache();
  });

  describe('getGlobalVersion', () => {
    it('should return version in format v1.YYYYMMDD.commitcount', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        if (cmd.includes('log -1 --format')) {
          return '2026-04-30T13:45:00+01:00';
        }
        if (cmd.includes('rev-list --count')) {
          return '143';
        }
        throw new Error('Unexpected command');
      });

      const version = getGlobalVersion();
      expect(version).not.toBeNull();
      expect(version?.version).toMatch(/^v1\.\d{8}\.\d+$/);
      expect(version?.date).toBe('20260430');
      expect(version?.commitCount).toBe(143);
    });

    it('should return null when no commit history found', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        throw new Error('fatal: your current branch has no commits yet');
      });

      const version = getGlobalVersion();
      expect(version).toBeNull();
    });

    it('should return null when not in a git repository', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: not a git repository');
      });

      const version = getGlobalVersion();
      expect(version).toBeNull();
    });

    it('should cache results for 30 seconds', () => {
      const gitCalls: string[] = [];
      mockExecSync.mockImplementation((cmd: string) => {
        gitCalls.push(cmd);
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        if (cmd.includes('log -1 --format')) {
          return '2026-04-30T13:45:00+01:00';
        }
        if (cmd.includes('rev-list --count')) {
          return '143';
        }
        throw new Error('Unexpected command');
      });

      getGlobalVersion();
      const logCallsAfterFirst = gitCalls.filter((c) => c.includes('log -1')).length;

      gitCalls.length = 0;

      // Second call should use cache and not call git log
      getGlobalVersion();
      const logCallsAfterSecond = gitCalls.filter((c) => c.includes('log -1')).length;

      expect(logCallsAfterSecond).toBe(0); // No new git log calls due to cache
    });
  });

  describe('getServiceVersion', () => {
    it('should return version for a specific service', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        if (cmd.includes('log -1 --format')) {
          return '2026-04-25T10:20:00Z';
        }
        if (cmd.includes('rev-list --count')) {
          return '127';
        }
        throw new Error('Unexpected command');
      });

      const version = getServiceVersion('api-gateway');
      expect(version).not.toBeNull();
      expect(version?.version).toMatch(/^v1\.\d{8}\.\d+$/);
      expect(version?.date).toBe('20260425');
      expect(version?.commitCount).toBe(127);
    });

    it('should return null if service has no commits', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        return '';
      });

      const version = getServiceVersion('nonexistent-service');
      expect(version).toBeNull();
    });
  });

  describe('getServiceVersions', () => {
    it('should return global and per-service versions', () => {
      let callCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        if (cmd.includes('log -1 --format')) {
          callCount++;
          // First call is for global
          if (callCount === 1) return '2026-04-30T13:45:00Z';
          // Subsequent calls vary by package
          return `2026-04-2${5 + (callCount % 3)}T10:00:00Z`;
        }
        if (cmd.includes('rev-list --count')) {
          return String(140 + (callCount % 10));
        }
        throw new Error('Unexpected command');
      });

      // Mock fs.readdirSync to return package names
      const fsModule = require('node:fs');
      vi.spyOn(fsModule, 'readdirSync').mockReturnValue(['api-gateway', 'cli', 'orchestrator']);
      vi.spyOn(fsModule, 'statSync').mockReturnValue({ isDirectory: () => true } as any);

      const versions = getServiceVersions();
      expect(versions).not.toBeNull();
      expect(versions?.global).toBeDefined();
      expect(versions?.global.version).toMatch(/^v1\.\d{8}\.\d+$/);
      expect(versions?.services).toBeDefined();
    });

    it('should return null when git operations fail', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Fatal error');
      });

      const versions = getServiceVersions();
      expect(versions).toBeNull();
    });
  });

  describe('version format', () => {
    it('should pad month and day with zeros', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        if (cmd.includes('log -1 --format')) {
          return '2026-01-05T08:30:00Z'; // January 5th
        }
        if (cmd.includes('rev-list --count')) {
          return '1';
        }
        throw new Error('Unexpected command');
      });

      const version = getGlobalVersion();
      expect(version?.date).toBe('20260105'); // Properly padded
    });

    it('should handle dates at year/month boundaries', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        if (cmd.includes('log -1 --format')) {
          return '2025-12-31T23:59:59Z'; // Last day of year
        }
        if (cmd.includes('rev-list --count')) {
          return '999';
        }
        throw new Error('Unexpected command');
      });

      const version = getGlobalVersion();
      expect(version?.date).toBe('20251231');
    });
  });

  describe('clearVersionCache', () => {
    it('should clear cached versions', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) {
          return '/fake/repo';
        }
        if (cmd.includes('log -1 --format')) {
          return '2026-04-30T13:45:00Z';
        }
        if (cmd.includes('rev-list --count')) {
          return '143';
        }
        throw new Error('Unexpected command');
      });

      const v1 = getGlobalVersion();
      const callCount1 = mockExecSync.mock.calls.length;

      clearVersionCache();

      const v2 = getGlobalVersion();
      const callCount2 = mockExecSync.mock.calls.length;

      // After clearing cache, new calls should be made
      expect(callCount2).toBeGreaterThan(callCount1);
    });
  });
});
