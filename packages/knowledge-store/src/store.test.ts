import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { KnowledgeStore } from './store.js';

function makeTmpDir(): string {
  // Use a subfolder within the package directory (cleaned up in afterEach)
  return join(process.cwd(), '.test-tmp', randomUUID());
}

describe('KnowledgeStore', () => {
  let baseDir: string;
  let store: KnowledgeStore;

  beforeEach(() => {
    baseDir = makeTmpDir();
    store = new KnowledgeStore(baseDir);
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('write() creates the file and all parent directories', async () => {
    const entry = await store.write('networking.extreme-xco', 'topology', '# Topology\nSome content');

    const filePath = join(baseDir, 'networking.extreme-xco', 'topology.md');
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);
    expect(entry.domain).toBe('networking.extreme-xco');
    expect(entry.topic).toBe('topology');
    expect(entry.content).toBe('# Topology\nSome content');
  });

  it('read() returns content after a write', async () => {
    await store.write('networking.extreme-xco', 'endpoints', '## Endpoints\n- 10.0.0.1');
    const entry = await store.read('networking.extreme-xco', 'endpoints');

    expect(entry).not.toBeNull();
    expect(entry?.content).toBe('## Endpoints\n- 10.0.0.1');
    expect(entry?.domain).toBe('networking.extreme-xco');
    expect(entry?.topic).toBe('endpoints');
    expect(entry?.updatedAt).toBeInstanceOf(Date);
  });

  it('read() returns null for a missing file', async () => {
    const result = await store.read('networking.extreme-xco', 'nonexistent');
    expect(result).toBeNull();
  });

  it('list() returns all topics across all domains', async () => {
    await store.write('networking.extreme-xco', 'topology', 'XCO topology');
    await store.write('networking.extreme-xco', 'endpoints', 'XCO endpoints');
    await store.write('networking.extreme-xiq', 'api', 'XIQ API');

    const topics = await store.list();

    expect(topics).toHaveLength(3);
    const topicNames = topics.map((t) => t.topic);
    expect(topicNames).toContain('topology');
    expect(topicNames).toContain('endpoints');
    expect(topicNames).toContain('api');
  });

  it('list(domain) returns only topics for that domain', async () => {
    await store.write('networking.extreme-xco', 'topology', 'XCO topology');
    await store.write('networking.extreme-xiq', 'api', 'XIQ API');

    const topics = await store.list('networking.extreme-xco');

    expect(topics).toHaveLength(1);
    expect(topics[0]?.domain).toBe('networking.extreme-xco');
    expect(topics[0]?.topic).toBe('topology');
  });

  it('search(query) finds topics whose content contains the query string', async () => {
    await store.write('networking.extreme-xco', 'topology', '# XCO Topology\nFabric node: spine-1');
    await store.write('networking.extreme-xco', 'endpoints', '# Endpoints\nController at 10.0.0.1');
    await store.write('networking.extreme-xiq', 'api', '# XIQ API\nBase URL: /v1');

    const matches = await store.search('spine-1');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.topic).toBe('topology');
  });
});
