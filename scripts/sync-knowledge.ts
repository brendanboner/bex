import { SkillRegistryClient } from '../packages/skill-registry-client/src/index.js';
import { KnowledgeStore } from '../packages/knowledge-store/src/index.js';
import { createHash } from 'crypto';

async function main() {
  const store = new KnowledgeStore('./knowledge');
  const client = new SkillRegistryClient();
  const entries = await client.listKnowledge();
  let synced = 0;
  for (const meta of entries) {
    if (meta.domain === 'agent') continue;
    const existing = await store.read(meta.domain, meta.topic);
    if (existing) {
      const checksum = createHash('sha256').update(existing.content).digest('hex');
      if (checksum === meta.checksum) { console.log(`  skip (current): ${meta.domain}/${meta.topic}`); continue; }
    }
    const manifest = await client.fetchKnowledge(meta.domain, meta.topic);
    await store.write(meta.domain, meta.topic, manifest.content);
    synced++;
    console.log(`  synced: ${meta.domain}/${meta.topic}`);
  }
  console.log(`\nDone — ${synced} file(s) synced`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
