import { promises as fs } from 'fs';
import { join, dirname } from 'path';

export interface KnowledgeTopic {
  domain: string;
  topic: string;
  path: string;
  sizeBytes: number;
  updatedAt: Date;
}

export interface KnowledgeEntry {
  domain: string;
  topic: string;
  content: string;
  updatedAt: Date;
}

export class KnowledgeStore {
  constructor(private baseDir: string) {}

  async read(domain: string, topic: string): Promise<KnowledgeEntry | null> {
    const filePath = join(this.baseDir, domain, `${topic}.md`);
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(filePath, 'utf-8'),
        fs.stat(filePath),
      ]);
      return { domain, topic, content, updatedAt: stat.mtime };
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(domain: string, topic: string, content: string): Promise<KnowledgeEntry> {
    const filePath = join(this.baseDir, domain, `${topic}.md`);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    const stat = await fs.stat(filePath);
    return { domain, topic, content, updatedAt: stat.mtime };
  }

  async delete(domain: string, topic: string): Promise<void> {
    const filePath = join(this.baseDir, domain, `${topic}.md`);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return;
      throw err;
    }
  }

  async list(domain?: string): Promise<KnowledgeTopic[]> {
    if (domain !== undefined) {
      return this._listDomain(domain);
    }

    let entries: string[];
    try {
      entries = await fs.readdir(this.baseDir);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }

    const results = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(this.baseDir, entry);
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) return this._listDomain(entry);
        return [];
      }),
    );

    return results.flat();
  }

  async search(query: string, domain?: string): Promise<KnowledgeTopic[]> {
    const topics = await this.list(domain);
    const lowerQuery = query.toLowerCase();

    const matches = await Promise.all(
      topics.map(async (topic) => {
        const entry = await this.read(topic.domain, topic.topic);
        if (entry && entry.content.toLowerCase().includes(lowerQuery)) return topic;
        return null;
      }),
    );

    return matches.filter((t): t is KnowledgeTopic => t !== null);
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private async _listDomain(domain: string): Promise<KnowledgeTopic[]> {
    const domainDir = join(this.baseDir, domain);
    let files: string[];
    try {
      files = await fs.readdir(domainDir);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }

    const topics = await Promise.all(
      files
        .filter((f) => f.endsWith('.md'))
        .map(async (file) => {
          const filePath = join(domainDir, file);
          const stat = await fs.stat(filePath);
          const topic = file.slice(0, -3); // remove .md
          return {
            domain,
            topic,
            path: `${domain}/${file}`,
            sizeBytes: stat.size,
            updatedAt: stat.mtime,
          } satisfies KnowledgeTopic;
        }),
    );

    return topics;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
