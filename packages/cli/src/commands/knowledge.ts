/**
 * bex knowledge <subcommand>
 *
 * Commands:
 *   bex knowledge list [domain]       — list all local knowledge docs
 *   bex knowledge push <domain>       — push all docs for a domain to the registry
 *   bex knowledge pull <domain>       — pull docs bundled with a registry skill
 *   bex knowledge show <domain> <topic> — show content of a knowledge doc
 */
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { findProjectRoot } from '../utils.js';

function getKnowledgeDir(): string {
  try {
    return join(findProjectRoot(), 'knowledge');
  } catch {
    return join(process.cwd(), 'knowledge');
  }
}

async function listDocs(domain?: string): Promise<void> {
  const baseDir = getKnowledgeDir();
  const scanDir = domain ? join(baseDir, domain) : baseDir;

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md')) {
        const topic = entry.name.slice(0, -3);
        const stat = await fs.stat(join(dir, entry.name));
        console.log(chalk.cyan(`${prefix}`) + chalk.dim('/') + chalk.white(topic) + chalk.dim(` (${stat.size}b)`));
      }
    }
  }

  console.log(chalk.bold('\nKnowledge Docs') + (domain ? chalk.dim(` — ${domain}`) : '') + '\n');
  await walk(scanDir, domain ?? '');
  console.log('');
}

async function showDoc(domain: string, topic: string): Promise<void> {
  const baseDir = getKnowledgeDir();
  const filePath = join(baseDir, domain, `${topic}.md`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    console.log(chalk.bold(`\n${domain}/${topic}\n`));
    console.log(content);
  } catch {
    console.error(chalk.red(`Not found: ${domain}/${topic}`));
  }
}

async function pushDocs(domain: string): Promise<void> {
  const { default: fetch } = await import('node-fetch');
  const baseDir = getKnowledgeDir();
  const domainDir = join(baseDir, domain);

  let entries;
  try {
    entries = await fs.readdir(domainDir, { withFileTypes: true });
  } catch {
    console.error(chalk.red(`Domain directory not found: ${domainDir}`));
    return;
  }

  const docs = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const topic = entry.name.slice(0, -3);
      const content = await fs.readFile(join(domainDir, entry.name), 'utf-8');
      docs.push({ domain, topic, content });
    }
  }

  if (docs.length === 0) {
    console.log(chalk.yellow(`No .md files found in knowledge/${domain}`));
    return;
  }

  // Read API URL from env
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:4000';
  const token = process.env['BEX_ADMIN_TOKEN'] ?? '';

  // Push each doc via the workspace API (use a synthetic agent ID "global" for shared docs)
  let pushed = 0;
  for (const doc of docs) {
    try {
      const res = await fetch(`${apiUrl}/knowledge/${doc.domain}/${doc.topic}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: doc.content }),
      });
      if (res.ok) {
        console.log(chalk.green('✓') + ` ${doc.domain}/${doc.topic}`);
        pushed++;
      } else {
        console.log(chalk.yellow('⚠') + ` ${doc.domain}/${doc.topic} — HTTP ${res.status}`);
      }
    } catch (e) {
      console.log(chalk.red('✗') + ` ${doc.domain}/${doc.topic} — ${(e as Error).message}`);
    }
  }

  console.log(chalk.bold(`\nPushed ${pushed}/${docs.length} docs for domain "${domain}"`));
}

async function pullDocs(skillDomain: string): Promise<void> {
  const { default: fetch } = await import('node-fetch');
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:4000';
  const token = process.env['BEX_ADMIN_TOKEN'] ?? '';

  // Search registry for skills in this domain
  const res = await fetch(`${apiUrl}/registry/skills?domain=${skillDomain}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    console.error(chalk.red(`Registry request failed: HTTP ${res.status}`));
    return;
  }

  const body = await res.json() as { ok: boolean; data?: { domain: string; version: string }[] };
  const skills = body.data ?? [];
  if (skills.length === 0) {
    console.log(chalk.yellow(`No registry skills found for domain "${skillDomain}"`));
    return;
  }

  // Fetch the latest version manifest to get bundled knowledge docs
  const latest = skills[0]!;
  const manifestRes = await fetch(`${apiUrl}/registry/skills/${latest.domain}/${latest.version}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!manifestRes.ok) {
    console.error(chalk.red(`Could not fetch manifest: HTTP ${manifestRes.status}`));
    return;
  }

  const manifestBody = await manifestRes.json() as { ok: boolean; data?: { knowledgeDocs?: { domain: string; topic: string; content: string }[] } };
  const docs = manifestBody.data?.knowledgeDocs ?? [];

  if (docs.length === 0) {
    console.log(chalk.yellow(`No knowledge docs bundled with skill "${latest.domain}@${latest.version}"`));
    return;
  }

  const baseDir = getKnowledgeDir();
  let saved = 0;
  for (const doc of docs) {
    const dir = join(baseDir, doc.domain);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, `${doc.topic}.md`), doc.content, 'utf-8');
    console.log(chalk.green('✓') + ` ${doc.domain}/${doc.topic}`);
    saved++;
  }

  console.log(chalk.bold(`\nPulled ${saved} knowledge docs from registry skill "${latest.domain}@${latest.version}"`));
}

export function buildKnowledgeCommand(): Command {
  const cmd = new Command('knowledge');
  cmd.description('Manage local knowledge docs (OpenClaw-style workspace documents)');

  cmd
    .command('list [domain]')
    .description('List local knowledge docs, optionally filtered by domain')
    .action(async (domain?: string) => {
      await listDocs(domain);
    });

  cmd
    .command('show <domain> <topic>')
    .description('Show content of a knowledge doc')
    .action(async (domain: string, topic: string) => {
      await showDoc(domain, topic);
    });

  cmd
    .command('push <domain>')
    .description('Push all local knowledge docs for a domain to the API (makes them available to agents)')
    .action(async (domain: string) => {
      console.log(chalk.bold(`\nPushing knowledge docs for "${domain}"...\n`));
      await pushDocs(domain);
    });

  cmd
    .command('pull <skill-domain>')
    .description('Pull knowledge docs bundled with a skill in the registry')
    .action(async (skillDomain: string) => {
      console.log(chalk.bold(`\nPulling knowledge docs for skill domain "${skillDomain}"...\n`));
      await pullDocs(skillDomain);
    });

  return cmd;
}
