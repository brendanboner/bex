import { createHash } from 'crypto';
import type { SkillManifest } from '@bclaw/shared';

export type RemoteSkill = {
  domain: string;
  version: string;
  name: string;
  description?: string;
  registryUrl: string;
  publishedAt: string;
};

export type RegistryListResponse = {
  ok: boolean;
  data: RemoteSkill[];
};

export type RegistryPublishResponse = {
  ok: boolean;
  data: {
    domain: string;
    version: string;
    url: string;
  };
};

/**
 * Computes a SHA-256 checksum of the skill's tools + systemPrompt.
 * Used for integrity verification when pulling from a remote registry.
 */
export function computeSkillChecksum(tools: unknown[], systemPrompt?: string): string {
  const payload = JSON.stringify({ tools, systemPrompt: systemPrompt ?? '' });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Client for interacting with a remote (or local) skill registry.
 * Any Forge instance can act as a registry by implementing the /registry/* endpoints.
 */
export class SkillRegistryClient {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(options?: { registryUrl?: string; authToken?: string }) {
    // Only use a non-empty URL. If SKILL_REGISTRY_URL is unset, isConfigured → false.
    const envUrl = process.env['SKILL_REGISTRY_URL'] ?? '';
    this.baseUrl = (options?.registryUrl ?? envUrl).replace(/\/$/, '');
    this.authToken = options?.authToken ?? process.env['SKILL_REGISTRY_TOKEN'] ?? 'bex-registry-dev';
  }

  /** True only when a registry URL has been explicitly configured (env or constructor). */
  get isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
    return headers;
  }

  /**
   * Lists all skills available in the remote registry.
   */
  async list(domain?: string): Promise<RemoteSkill[]> {
    if (!this.isConfigured) return [];
    const url = domain
      ? `${this.baseUrl}/registry/skills?domain=${encodeURIComponent(domain)}`
      : `${this.baseUrl}/registry/skills`;

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Registry list failed: ${res.status} ${res.statusText}`);

    const body = (await res.json()) as RegistryListResponse;
    return body.data ?? [];
  }

  /**
   * Publishes a skill manifest to the remote registry.
   */
  async publish(manifest: SkillManifest): Promise<{ url: string }> {
    if (!this.isConfigured) {
      throw new Error('SKILL_REGISTRY_URL is not configured. Cannot publish to registry.');
    }

    const res = await fetch(`${this.baseUrl}/registry/publish`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(manifest),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Registry publish failed: ${res.status} ${text}`);
    }

    const body = (await res.json()) as RegistryPublishResponse;
    return { url: body.data.url };
  }

  /**
   * Fetches a specific skill manifest from the registry.
   */
  async fetch(domain: string, version: string): Promise<SkillManifest> {
    if (!this.isConfigured) {
      throw new Error('SKILL_REGISTRY_URL is not configured.');
    }

    const res = await fetch(
      `${this.baseUrl}/registry/skills/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`,
      { headers: this.headers() },
    );

    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { ok: boolean; data: SkillManifest };
    return body.data;
  }

  /**
   * Verifies a skill manifest's checksum.
   */
  verify(manifest: SkillManifest): boolean {
    const expected = computeSkillChecksum(
      manifest.tools as unknown[],
      manifest.systemPrompt,
    );
    return expected === manifest.checksum;
  }
}
