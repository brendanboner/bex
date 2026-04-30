import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { computeSkillChecksum, SkillRegistryClient } from '../src/client.js';
import type { SkillManifest } from '@bex/shared';

const sampleTools = [
  { name: 'get_devices', description: 'List all devices', parameters: { type: 'object', properties: {} } },
];

describe('computeSkillChecksum', () => {
  it('produces a 64-char hex SHA-256 string', () => {
    const checksum = computeSkillChecksum(sampleTools, 'You are a network operator.');
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = computeSkillChecksum(sampleTools, 'prompt');
    const b = computeSkillChecksum(sampleTools, 'prompt');
    expect(a).toBe(b);
  });

  it('differs when tools change', () => {
    const a = computeSkillChecksum(sampleTools, 'prompt');
    const b = computeSkillChecksum([{ ...sampleTools[0]!, name: 'list_devices' }], 'prompt');
    expect(a).not.toBe(b);
  });

  it('differs when systemPrompt changes', () => {
    const a = computeSkillChecksum(sampleTools, 'prompt A');
    const b = computeSkillChecksum(sampleTools, 'prompt B');
    expect(a).not.toBe(b);
  });
});

describe('SkillRegistryClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env['SKILL_REGISTRY_URL'] = 'https://registry.example.com';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SKILL_REGISTRY_URL'];
  });

  it('isConfigured is true when SKILL_REGISTRY_URL is set', () => {
    const client = new SkillRegistryClient();
    expect(client.isConfigured).toBe(true);
  });

  it('isConfigured is true even when no env URL is set (uses default public registry)', () => {
    delete process.env['SKILL_REGISTRY_URL'];
    const client = new SkillRegistryClient();
    expect(client.isConfigured).toBe(true);
  });

  it('isConfigured is false when explicitly overridden with empty URL', () => {
    const client = new SkillRegistryClient({ registryUrl: '' });
    expect(client.isConfigured).toBe(false);
  });

  it('list() returns empty array when explicitly not configured', async () => {
    const client = new SkillRegistryClient({ registryUrl: '' });
    const result = await client.list();
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('list() calls registry /registry/skills', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: [{ domain: 'networking.xco', version: '1.0.0' }] }),
    });
    const client = new SkillRegistryClient();
    const result = await client.list();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/registry/skills',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.domain).toBe('networking.xco');
  });

  it('verify() returns true for a manifest with correct checksum', () => {
    const tools = sampleTools;
    const systemPrompt = 'You are a network operator.';
    const checksum = computeSkillChecksum(tools, systemPrompt);

    const manifest: SkillManifest = {
      name: 'XCO Skill',
      domain: 'networking.xco',
      version: '1.0.0',
      capabilities: ['list-devices'],
      tools,
      systemPrompt,
      checksum,
      publishedAt: new Date().toISOString(),
    };

    const client = new SkillRegistryClient();
    expect(client.verify(manifest)).toBe(true);
  });

  it('verify() returns false for a tampered manifest', () => {
    const manifest: SkillManifest = {
      name: 'XCO Skill',
      domain: 'networking.xco',
      version: '1.0.0',
      capabilities: ['list-devices'],
      tools: sampleTools,
      checksum: 'aaaa', // wrong
      publishedAt: new Date().toISOString(),
    };

    const client = new SkillRegistryClient();
    expect(client.verify(manifest)).toBe(false);
  });
});
