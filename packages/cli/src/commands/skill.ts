/**
 * bex skill <subcommand>
 *
 * Commands:
 *   bex skill list              — list skills in the local registry
 *   bex skill search <keyword>  — search registry by keyword (domain/name/description)
 *   bex skill get <app>         — import a Composio toolkit as a BEX skill (needs COMPOSIO_API_KEY)
 *   bex skill push <domain>     — push a DB skill to the registry
 *   bex skill push --all        — push all DB skills to the registry
 *   bex skill pull <domain>     — pull a skill from the registry into DB
 *   bex skill delete <domain>   — delete a skill from the registry
 *   bex skill info <domain>     — show skill details
 */
import { Command } from 'commander';
import path from 'path';
import { readFileSync } from 'fs';

// Resolve .env from repo root relative to this file
function loadEnv(): Record<string, string> {
  try {
    // dist/commands/skill.js → ../../.. → repo root
    const root = path.resolve(__dirname, '..', '..', '..', '..');
    const envPath = path.join(root, '.env');
    const raw = readFileSync(envPath, 'utf8');
    const env: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

async function getRegistryUrl(env: Record<string, string>): Promise<string> {
  return env['SKILL_REGISTRY_URL'] ?? process.env['SKILL_REGISTRY_URL'] ?? 'http://localhost:5050';
}

async function getRegistryToken(env: Record<string, string>): Promise<string> {
  return env['SKILL_REGISTRY_TOKEN'] ?? process.env['SKILL_REGISTRY_TOKEN'] ?? '';
}

async function getPrisma(env: Record<string, string>) {
  // Set DATABASE_URL so Prisma picks it up
  const dbUrl = env['DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (dbUrl) process.env['DATABASE_URL'] = dbUrl;

  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient();
}

function headers(token: string) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Resolve `latest` to the actual version stored for a domain. Falls back to `1.0.0`. */
async function resolveVersion(fetch: typeof import('undici').fetch, registryUrl: string, token: string, domain: string, requested?: string): Promise<string> {
  if (requested && requested !== 'latest') return requested;
  try {
    const res = await fetch(`${registryUrl}/registry/skills`, { headers: headers(token) });
    if (!res.ok) return '1.0.0';
    const data = await res.json() as { ok: boolean; data?: Array<{ domain: string; version: string }> };
    const found = data.data?.find(s => s.domain === domain);
    return found?.version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

// ── list ───────────────────────────────────────────────────────────────────
export async function skillListCommand(): Promise<void> {
  const { fetch } = await import('undici');
  const env = loadEnv();
  const registryUrl = await getRegistryUrl(env);
  const token = await getRegistryToken(env);

  const res = await fetch(`${registryUrl}/registry/skills`, { headers: headers(token) });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Registry error ${res.status}: ${txt.slice(0, 200)}`);
    process.exit(1);
  }
  const data = await res.json() as { ok: boolean; data: Array<{ domain: string; version: string; name: string; published_at: string }> };
  if (!data.ok || !Array.isArray(data.data) || data.data.length === 0) {
    console.log('No skills in registry.');
    return;
  }
  console.log(`\n${'DOMAIN'.padEnd(45)} ${'VERSION'.padEnd(10)} NAME`);
  console.log('─'.repeat(90));
  for (const s of data.data) {
    console.log(`${s.domain.padEnd(45)} ${s.version.padEnd(10)} ${s.name}`);
  }
  console.log(`\n${data.data.length} skill(s) in registry at ${registryUrl}\n`);
}

// ── push ───────────────────────────────────────────────────────────────────
export async function skillPushCommand(domain: string | undefined, opts: { all?: boolean }): Promise<void> {
  const { fetch } = await import('undici');
  const env = loadEnv();
  const apiUrl = env['API_GATEWAY_URL'] ?? process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
  const apiToken = env['BEX_BOT_API_KEY'] ?? process.env['BEX_BOT_API_KEY'] ?? env['ADMIN_TOKEN'] ?? '';
  const prisma = await getPrisma(env);

  // Resolve skill IDs — push goes through the API gateway's publish-to-registry
  // endpoint so domain knowledge (entity graph + playbooks) is bundled in the manifest.
  let skills: Array<{ id: string; domain: string; version: string }>;

  if (opts.all) {
    skills = await prisma.skill.findMany({ select: { id: true, domain: true, version: true } });
  } else if (domain) {
    const s = await prisma.skill.findFirst({ where: { domain }, select: { id: true, domain: true, version: true } });
    if (!s) { console.error(`Skill not found in DB: ${domain}`); process.exit(1); }
    skills = [s];
  } else {
    console.error('Specify a domain or use --all');
    process.exit(1);
  }

  await prisma.$disconnect();

  let ok = 0, fail = 0;
  for (const skill of skills) {
    const res = await fetch(`${apiUrl}/skills/${skill.id}/publish-to-registry`, {
      method: 'POST',
      headers: headers(apiToken),
      body: '{}',
    });
    if (res.ok) {
      console.log(`  ✅ Pushed: ${skill.domain}@${skill.version}`);
      ok++;
    } else {
      const txt = await res.text();
      console.error(`  ❌ Failed: ${skill.domain} — ${res.status}: ${txt.slice(0, 100)}`);
      fail++;
    }
  }
  console.log(`\nPushed ${ok}/${skills.length} skill(s)${fail > 0 ? `, ${fail} failed` : ''}.`);
}

// ── pull ───────────────────────────────────────────────────────────────────
export async function skillPullCommand(domain: string, opts: { version?: string }): Promise<void> {
  const { fetch } = await import('undici');
  const env = loadEnv();
  const registryUrl = await getRegistryUrl(env);
  const token = await getRegistryToken(env);
  const prisma = await getPrisma(env);

  const version = await resolveVersion(fetch, registryUrl, token, domain, opts.version);
  const res = await fetch(`${registryUrl}/registry/skills/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`, {
    headers: headers(token),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`Pull failed ${res.status}: ${txt.slice(0, 200)}`);
    process.exit(1);
  }

  const payload = await res.json() as { ok: boolean; data?: Record<string, unknown> } | Record<string, unknown>;
  // The registry returns the manifest directly as the `data` field (not nested)
  const manifest = (payload as any).ok === false
    ? (() => { console.error('Registry error:', JSON.stringify(payload)); process.exit(1); })()
    : ((payload as any).data ?? payload) as Record<string, unknown>;

  const existing = await prisma.skill.findFirst({ where: { domain }, select: { id: true } });
  if (existing) {
    await prisma.skill.update({
      where: { id: existing.id },
      data: {
        name: manifest['name'] as string,
        version: manifest['version'] as string,
        description: (manifest['description'] as string) ?? null,
        capabilities: (manifest['capabilities'] as string[]) ?? [],
        systemPrompt: (manifest['systemPrompt'] as string) ?? null,
        tools: manifest['tools'] as never,
      },
    });
    console.log(`✅ Updated ${domain}@${manifest['version']} in DB (id: ${existing.id})`);
  } else {
    const created = await prisma.skill.create({
      data: {
        domain,
        name: manifest['name'] as string,
        version: (manifest['version'] as string) ?? '1.0.0',
        description: (manifest['description'] as string) ?? null,
        capabilities: (manifest['capabilities'] as string[]) ?? [],
        systemPrompt: (manifest['systemPrompt'] as string) ?? null,
        tools: manifest['tools'] as never,
      },
    });
    console.log(`✅ Pulled ${domain}@${manifest['version']} into DB (id: ${created.id})`);
  }
  await prisma.$disconnect();
}

// ── delete ─────────────────────────────────────────────────────────────────
export async function skillDeleteCommand(domain: string, opts: { version?: string }): Promise<void> {
  const { fetch } = await import('undici');
  const env = loadEnv();
  const registryUrl = await getRegistryUrl(env);
  // DELETE uses SKILL_REGISTRY_ADMIN_TOKEN if set (separate high-privilege token), else SKILL_REGISTRY_TOKEN
  const adminToken = env['SKILL_REGISTRY_ADMIN_TOKEN'] ?? process.env['SKILL_REGISTRY_ADMIN_TOKEN'] ?? await getRegistryToken(env);

  const version = await resolveVersion(fetch, registryUrl, adminToken, domain, opts.version);
  const res = await fetch(`${registryUrl}/registry/skills/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`, {
    method: 'DELETE',
    headers: headers(adminToken),
  });

  if (res.ok) {
    console.log(`✅ Deleted ${domain}@${version} from registry`);
  } else if (res.status === 401) {
    console.error('❌ Unauthorized — DELETE may require a separate admin token (SKILL_REGISTRY_ADMIN_TOKEN in .env)');
    process.exit(1);
  } else {
    const txt = await res.text();
    console.error(`Delete failed ${res.status}: ${txt.slice(0, 200)}`);
    process.exit(1);
  }
}

// ── info ───────────────────────────────────────────────────────────────────
export async function skillInfoCommand(domain: string, opts: { version?: string }): Promise<void> {
  const { fetch } = await import('undici');
  const env = loadEnv();
  const registryUrl = await getRegistryUrl(env);
  const token = await getRegistryToken(env);

  const version = await resolveVersion(fetch, registryUrl, token, domain, opts.version);
  const res = await fetch(`${registryUrl}/registry/skills/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`, {
    headers: headers(token),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`${res.status}: ${txt.slice(0, 200)}`);
    process.exit(1);
  }

  const payload = await res.json() as Record<string, unknown>;
  if ((payload as any).ok === false) { console.error(`Registry error ${res.status}:`, JSON.stringify(payload)); process.exit(1); }
  const manifest = ((payload as any).data ?? payload) as Record<string, unknown>;

  const tools = (manifest['tools'] as unknown[]) ?? [];
  const writeable = tools.filter((t: any) => t.config?.isWrite).length;

  console.log(`\n  Skill:       ${manifest['name']}`);
  console.log(`  Domain:      ${manifest['domain']}`);
  console.log(`  Version:     ${manifest['version']}`);
  console.log(`  Tools:       ${tools.length} (${writeable} write, ${tools.length - writeable} read)`);
  if (manifest['capabilities']) {
    const caps = manifest['capabilities'] as string[];
    console.log(`  Capabilities:`);
    caps.slice(0, 8).forEach(c => console.log(`    - ${c}`));
    if (caps.length > 8) console.log(`    … and ${caps.length - 8} more`);
  }
  console.log();
}

// ── search ─────────────────────────────────────────────────────────────────
export async function skillSearchCommand(keyword: string): Promise<void> {
  const { fetch } = await import('undici');
  const env = loadEnv();
  const registryUrl = await getRegistryUrl(env);
  const token = await getRegistryToken(env);

  const res = await fetch(`${registryUrl}/registry/skills`, { headers: headers(token) });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Registry error ${res.status}: ${txt.slice(0, 200)}`);
    process.exit(1);
  }
  const data = await res.json() as { ok: boolean; data: Array<{ domain: string; version: string; name: string; description?: string; published_at: string }> };
  if (!data.ok || !Array.isArray(data.data)) {
    console.log('No skills in registry.');
    return;
  }

  const q = keyword.toLowerCase();
  const matches = data.data.filter(s =>
    s.domain.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q) ||
    (s.description ?? '').toLowerCase().includes(q)
  );

  if (matches.length === 0) {
    console.log(`\nNo skills matched "${keyword}" in registry at ${registryUrl}`);
    console.log(`\nTo import from Composio (1000+ integrations), set COMPOSIO_API_KEY in .env then run:`);
    console.log(`  bex skill get ${keyword}\n`);
    return;
  }

  console.log(`\n${'DOMAIN'.padEnd(45)} ${'VERSION'.padEnd(10)} NAME`);
  console.log('─'.repeat(90));
  for (const s of matches) {
    console.log(`${s.domain.padEnd(45)} ${s.version.padEnd(10)} ${s.name}`);
    if (s.description) console.log(`  ${s.description.slice(0, 85)}`);
  }
  console.log(`\n${matches.length} match(es) — pull with: bex skill pull <domain>\n`);
}

// ── get (Composio import) ──────────────────────────────────────────────────
interface ComposioTool {
  name: string;
  display_name?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  no_auth?: boolean;
}

export async function skillGetCommand(appName: string, opts: { dryRun?: boolean; limit?: string }): Promise<void> {
  const { fetch } = await import('undici');
  const env = loadEnv();
  const apiKey = env['COMPOSIO_API_KEY'] ?? process.env['COMPOSIO_API_KEY'] ?? '';

  if (!apiKey) {
    console.error(`\n❌ COMPOSIO_API_KEY not set.`);
    console.error(`\nGet a free key at https://app.composio.dev then add to .env:`);
    console.error(`  COMPOSIO_API_KEY=your-key-here\n`);
    process.exit(1);
  }

  const composioBase = 'https://backend.composio.dev/api/v3';
  const hdrs = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
  const maxTools = parseInt(opts.limit ?? '20', 10);

  console.log(`\nFetching tools for "${appName}" from Composio...`);

  // Find matching toolkit
  const toolkitRes = await fetch(`${composioBase}/toolkits?search=${encodeURIComponent(appName)}&limit=5`, { headers: hdrs });
  if (!toolkitRes.ok) {
    if (toolkitRes.status === 401) {
      console.error(`❌ Invalid COMPOSIO_API_KEY — check your key at https://app.composio.dev`);
    } else {
      const txt = await toolkitRes.text();
      console.error(`Composio error ${toolkitRes.status}: ${txt.slice(0, 200)}`);
    }
    process.exit(1);
  }

  const toolkitData = await toolkitRes.json() as { items?: Array<{ slug: string; name: string; description?: string; no_auth?: boolean }> };
  const toolkits = toolkitData.items ?? [];
  if (toolkits.length === 0) {
    console.error(`❌ No Composio toolkit found matching "${appName}"`);
    console.error(`\nBrowse all 1000+ toolkits at: https://composio.dev/toolkits`);
    process.exit(1);
  }

  const toolkit = toolkits[0]!;
  console.log(`  Found: ${toolkit.name} (${toolkit.slug})${toolkit.no_auth ? ' — no auth required' : ' — requires credentials'}`);
  if (toolkit.description) console.log(`  ${toolkit.description.slice(0, 100)}`);

  // Fetch tools for the toolkit
  const toolsRes = await fetch(`${composioBase}/tools?toolkit=${encodeURIComponent(toolkit.slug)}&limit=${maxTools}`, { headers: hdrs });
  if (!toolsRes.ok) {
    const txt = await toolsRes.text();
    console.error(`Composio tools error ${toolsRes.status}: ${txt.slice(0, 200)}`);
    process.exit(1);
  }

  const toolsData = await toolsRes.json() as { items?: ComposioTool[] };
  const tools: ComposioTool[] = toolsData.items ?? [];
  if (tools.length === 0) {
    console.error(`❌ No tools found for toolkit "${toolkit.slug}"`);
    process.exit(1);
  }

  console.log(`  Tools: ${tools.length} available (importing first ${Math.min(tools.length, maxTools)})`);

  // Convert Composio tool schemas to BEX SkillTool format
  const bexTools = tools.slice(0, maxTools).map((t: ComposioTool) => ({
    name: t.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z_]/, '_$&'),
    description: (t.description ?? t.display_name ?? t.name).slice(0, 500),
    parameters: t.input_schema ?? t.parameters ?? { type: 'object', properties: {}, required: [] },
    handlerType: 'composio_call',
    composioAction: t.name,
    composioToolkit: toolkit.slug,
  }));

  const domain = `composio.${toolkit.slug.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const skillName = `Composio — ${toolkit.name}`;
  const capabilities = tools.slice(0, maxTools).map((t: ComposioTool) => t.display_name ?? t.name);

  const systemPrompt = [
    `You have access to ${toolkit.name} via Composio.`,
    toolkit.description ? toolkit.description : '',
    toolkit.no_auth
      ? 'No authentication is required for these tools.'
      : `These tools require the user to have connected their ${toolkit.name} account via Composio (OAuth/API key).`,
    `Always confirm the action before writing or deleting data.`,
  ].filter(Boolean).join(' ');

  if (opts.dryRun) {
    console.log(`\n[dry-run] Would create skill:`);
    console.log(`  Domain:  ${domain}`);
    console.log(`  Name:    ${skillName}`);
    console.log(`  Tools:   ${bexTools.length}`);
    bexTools.forEach(t => console.log(`    - ${t.name}`));
    console.log();
    return;
  }

  const prisma = await getPrisma(env);
  try {
    const existing = await prisma.skill.findFirst({ where: { domain }, select: { id: true } });
    if (existing) {
      await prisma.skill.update({
        where: { id: existing.id },
        data: { name: skillName, version: '1.0.0', capabilities, systemPrompt, tools: bexTools as never },
      });
      console.log(`\n✅ Updated skill: ${domain} (${bexTools.length} tools)`);
    } else {
      const created = await prisma.skill.create({
        data: { domain, name: skillName, version: '1.0.0', description: toolkit.description ?? null, capabilities, systemPrompt, tools: bexTools as never },
      });
      console.log(`\n✅ Created skill: ${domain} (id: ${created.id}, ${bexTools.length} tools)`);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nNext steps:`);
  if (!toolkit.no_auth) {
    console.log(`  1. Connect ${toolkit.name} at: https://app.composio.dev/connections`);
    console.log(`  2. Set COMPOSIO_API_KEY in .env (already done)`);
  }
  console.log(`  Assign skill to an agent in the dashboard, or create a new agent for ${toolkit.name}.`);
  console.log(`  Note: composio_call handler must be present in llm-runner for tools to execute.\n`);
}

// ── Command builder ────────────────────────────────────────────────────────
export function buildSkillCommand(): Command {
  const skill = new Command('skill').description('Manage skills in the registry');

  skill
    .command('list')
    .description('List all skills in the registry')
    .action(skillListCommand);

  skill
    .command('search <keyword>')
    .description('Search registry by keyword (domain, name, or description)')
    .action(skillSearchCommand);

  skill
    .command('get <app>')
    .description('Import a Composio toolkit as a BEX skill (requires COMPOSIO_API_KEY in .env)')
    .option('--dry-run', 'Preview tools without importing')
    .option('--limit <n>', 'Max tools to import (default: 20)')
    .action(skillGetCommand);

  skill
    .command('push [domain]')
    .description('Push a skill from the database to the registry')
    .option('--all', 'Push all skills')
    .action(skillPushCommand);

  skill
    .command('pull <domain>')
    .description('Pull a skill from the registry into the database')
    .option('--version <version>', 'Specific version (default: latest)')
    .action(skillPullCommand);

  skill
    .command('delete <domain>')
    .description('Delete a skill from the registry')
    .option('--version <version>', 'Specific version (default: latest)')
    .action(skillDeleteCommand);

  skill
    .command('info <domain>')
    .description('Show skill details from the registry')
    .option('--version <version>', 'Specific version (default: latest)')
    .action(skillInfoCommand);

  return skill;
}
