import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type SkillRow = {
  domain: string;
  version: string;
  name: string;
  description: string | null;
  checksum: string;
  manifest: string;
  published_at: string;
};

export type InsertRow = Omit<SkillRow, 'published_at'>;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = process.env['DATA_DIR'] ?? './data';
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'registry.db');
  _db = new Database(dbPath);

  _db.pragma('journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      domain       TEXT NOT NULL,
      version      TEXT NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT,
      checksum     TEXT NOT NULL,
      manifest     TEXT NOT NULL,
      published_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (domain, version)
    )
  `);

  return _db;
}

export function listSkills(domain?: string): SkillRow[] {
  const db = getDb();
  if (domain) {
    return db
      .prepare<[string], SkillRow>('SELECT * FROM skills WHERE domain LIKE ? ORDER BY published_at DESC')
      .all(`%${domain}%`);
  }
  return db
    .prepare<[], SkillRow>('SELECT * FROM skills ORDER BY published_at DESC')
    .all();
}

export function getSkill(domain: string, version: string): SkillRow | undefined {
  return getDb()
    .prepare<[string, string], SkillRow>('SELECT * FROM skills WHERE domain = ? AND version = ?')
    .get(domain, version);
}

export function upsertSkill(row: InsertRow): void {
  getDb()
    .prepare<[string, string, string, string | null, string, string]>(`
      INSERT INTO skills (domain, version, name, description, checksum, manifest)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (domain, version) DO UPDATE SET
        name        = excluded.name,
        description = excluded.description,
        checksum    = excluded.checksum,
        manifest    = excluded.manifest,
        published_at = datetime('now')
    `)
    .run(row.domain, row.version, row.name, row.description ?? null, row.checksum, row.manifest);
}

export function deleteSkill(domain: string, version: string): void {
  getDb()
    .prepare<[string, string]>('DELETE FROM skills WHERE domain = ? AND version = ?')
    .run(domain, version);
}
