import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Version format: v1.YYYYMMDD.commitcount
 * Example: v1.20260430.143 (April 30, 2026 with 143 commits to that date)
 */

interface VersionInfo {
  version: string;
  date: string;
  commitCount: number;
  timestamp: Date;
}

interface ServiceVersions {
  global: VersionInfo;
  services: Record<string, VersionInfo>;
}

const VERSION_CACHE = new Map<string, VersionInfo & { cachedAt: number }>();
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Get the last commit date for a given path or package
 */
function getLastCommitDate(packagePath: string): Date | null {
  try {
    const cmd = `git log -1 --format=%aI -- "${packagePath}"`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (!output) return null;
    return new Date(output);
  } catch {
    return null;
  }
}

/**
 * Count commits up to and including a specific date
 */
function countCommitsUntilDate(packagePath: string, targetDate: Date): number {
  try {
    const dateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const cmd = `git rev-list --count --until="${dateStr}T23:59:59Z" HEAD -- "${packagePath}"`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Format a date as YYYYMMDD
 */
function formatDateYYYYMMDD(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Calculate version string in format v1.YYYYMMDD.commitcount
 */
function calculateVersion(packagePath: string): VersionInfo | null {
  // Check cache first
  const cached = VERSION_CACHE.get(packagePath);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { version: cached.version, date: cached.date, commitCount: cached.commitCount, timestamp: cached.timestamp };
  }

  const lastCommitDate = getLastCommitDate(packagePath);
  if (!lastCommitDate) {
    return null;
  }

  const dateStr = formatDateYYYYMMDD(lastCommitDate);
  const commitCount = countCommitsUntilDate(packagePath, lastCommitDate);
  const version = `v1.${dateStr}.${commitCount}`;

  const versionInfo: VersionInfo = {
    version,
    date: dateStr,
    commitCount,
    timestamp: lastCommitDate,
  };

  // Cache the result
  VERSION_CACHE.set(packagePath, { ...versionInfo, cachedAt: Date.now() });

  return versionInfo;
}

/**
 * Get the root git directory
 */
function getGitRoot(): string {
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return root;
  } catch {
    throw new Error('Not in a git repository');
  }
}

/**
 * Get versions for all services
 */
export function getServiceVersions(projectRoot?: string): ServiceVersions | null {
  try {
    const gitRoot = projectRoot || getGitRoot();
    const packagesDir = path.join(gitRoot, 'packages');

    // Get global version (most recent commit across entire repo)
    const globalVersion = calculateVersion(gitRoot);
    if (!globalVersion) {
      return null;
    }

    // Get per-service versions
    const services: Record<string, VersionInfo> = {};
    let packageDirs: string[] = [];

    try {
      const fs = require('node:fs');
      packageDirs = fs
        .readdirSync(packagesDir)
        .filter((f: string) => fs.statSync(path.join(packagesDir, f)).isDirectory())
        .map((f: string) => path.join(packagesDir, f));
    } catch {
      // If we can't read packages dir, just return global
      return { global: globalVersion, services };
    }

    for (const pkgPath of packageDirs) {
      const pkgName = path.basename(pkgPath);
      const version = calculateVersion(pkgPath);
      if (version) {
        services[pkgName] = version;
      }
    }

    return {
      global: globalVersion,
      services,
    };
  } catch {
    return null;
  }
}

/**
 * Get version for a specific service/package by name
 */
export function getServiceVersion(packageName: string, projectRoot?: string): VersionInfo | null {
  try {
    const gitRoot = projectRoot || getGitRoot();
    const packagesDir = path.join(gitRoot, 'packages');
    const pkgPath = path.join(packagesDir, packageName);

    return calculateVersion(pkgPath);
  } catch {
    return null;
  }
}

/**
 * Get global version (most recent commit across entire repo)
 */
export function getGlobalVersion(projectRoot?: string): VersionInfo | null {
  try {
    const gitRoot = projectRoot || getGitRoot();
    return calculateVersion(gitRoot);
  } catch {
    return null;
  }
}

/**
 * Clear version cache (useful for testing or manual refresh)
 */
export function clearVersionCache(): void {
  VERSION_CACHE.clear();
}

/**
 * Set cache TTL in milliseconds (for testing)
 */
export function setCacheTTL(ttlMs: number): void {
  (global as any).__BEX_VERSION_CACHE_TTL = ttlMs;
}
