/**
 * SkillProberService — validates skill tool chains against real API endpoints.
 *
 * For each tool in a skill that has a public (no-credential) HTTP endpoint:
 * 1. Makes a minimal test call with placeholder/default params
 * 2. Records the real response field names in learnedNotes
 * 3. Flags chain mismatches: required inputs to tool N not available from any prior tool's output
 *
 * The probe is best-effort — errors are caught and stored as notes, never thrown.
 */

import { PrismaClient } from '@prisma/client';

interface ToolDef {
  name: string;
  endpoint?: string;
  method?: string;
  handlerType?: string;
  parameters?: {
    type?: string;
    required?: string[];
    properties?: Record<string, { type?: string; description?: string }>;
  };
  description?: string;
}

interface ProbeNote {
  tool: string;
  status: 'ok' | 'error' | 'skipped';
  responseFields?: string[];
  error?: string;
  url?: string;
}

export class SkillProberService {
  constructor(private readonly prisma: PrismaClient) {}

  async probe(skillId: string): Promise<void> {
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      select: { tools: true, learnedNotes: true },
    });
    if (!skill) return;

    const tools = (skill.tools as unknown as ToolDef[]) ?? [];
    if (!tools.length) return;

    const notes: ProbeNote[] = [];
    // Track what fields each tool's response exposes (for chain mismatch detection)
    const toolOutputFields = new Map<string, string[]>();

    const { fetch } = await import('undici');

    for (const tool of tools) {
      // Only probe tools with public endpoints (no credential required)
      if (!tool.endpoint) {
        notes.push({ tool: tool.name, status: 'skipped', error: 'No endpoint configured' });
        continue;
      }
      if (tool.handlerType && tool.handlerType !== 'http_call') {
        notes.push({ tool: tool.name, status: 'skipped', error: `Handler type ${tool.handlerType} requires credentials` });
        continue;
      }

      // Build a minimal request using default/example values from param descriptions
      const method = (tool.method ?? 'GET').toUpperCase();
      const props = tool.parameters?.properties ?? {};
      const required = tool.parameters?.required ?? [];

      // Build sample args: use required params only, with sensible defaults
      const sampleArgs: Record<string, string | number> = {};
      for (const [key, val] of Object.entries(props)) {
        if (!required.includes(key)) continue;
        const desc = (val.description ?? '').toLowerCase();
        const type = val.type ?? 'string';
        // Extract example value from description if present (e.g. "Always use: auto")
        const alwaysUse = desc.match(/always use:?\s*([^\s,\.]+)/)?.[1];
        const useValue = desc.match(/use:?\s*([a-z0-9_,]+)/)?.[1];
        if (alwaysUse) {
          sampleArgs[key] = type === 'number' || type === 'integer' ? Number(alwaysUse) || 0 : alwaysUse;
        } else if (useValue) {
          sampleArgs[key] = type === 'number' || type === 'integer' ? Number(useValue) || 0 : useValue;
        } else if (type === 'number' || type === 'integer') {
          sampleArgs[key] = 0;
        } else {
          sampleArgs[key] = '__probe__';
        }
      }

      try {
        let url = tool.endpoint;
        if (method === 'GET') {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(sampleArgs)) {
            if (v !== null && v !== '') params.set(k, String(v));
          }
          const qs = params.toString();
          if (qs) url = `${url}?${qs}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        let resp: Response;
        try {
          const opts: Parameters<typeof fetch>[1] = {
            method,
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          };
          if (method !== 'GET' && method !== 'HEAD') {
            opts.body = JSON.stringify(sampleArgs);
          }
          resp = (await fetch(url, opts)) as unknown as Response;
        } finally {
          clearTimeout(timer);
        }

        const text = await resp.text();
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = null; }

        if (!resp.ok) {
          notes.push({ tool: tool.name, status: 'error', url, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` });
          continue;
        }

        // Extract top-level response fields (and first-level of arrays)
        const responseFields: string[] = [];
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed)) {
            responseFields.push('(array)');
            if (parsed.length > 0 && typeof parsed[0] === 'object') {
              responseFields.push(...Object.keys(parsed[0] as object).map((k) => `[0].${k}`));
            }
          } else {
            for (const [k, v] of Object.entries(parsed as object)) {
              responseFields.push(k);
              if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
                responseFields.push(...Object.keys(v[0] as object).map((sk) => `${k}[0].${sk}`));
              } else if (v && typeof v === 'object' && !Array.isArray(v)) {
                responseFields.push(...Object.keys(v as object).map((sk) => `${k}.${sk}`));
              }
            }
          }
        }

        toolOutputFields.set(tool.name, responseFields);
        notes.push({ tool: tool.name, status: 'ok', url, responseFields });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notes.push({ tool: tool.name, status: 'error', error: msg.slice(0, 200) });
      }
    }

    // Chain mismatch detection: for each tool, check required inputs are available from prior outputs
    const mismatches: string[] = [];
    const allPriorFields = new Set<string>();
    for (const tool of tools) {
      const required = tool.parameters?.required ?? [];
      for (const field of required) {
        const isProvidedByPrior = [...allPriorFields].some(
          (f) => f === field || f.endsWith(`.${field}`) || f.endsWith(`[0].${field}`),
        );
        if (!isProvidedByPrior && allPriorFields.size > 0) {
          // Field not found in any prior tool output — potential mismatch
          mismatches.push(`Tool "${tool.name}" requires "${field}" but it was not found in any prior tool's output`);
        }
      }
      // Add this tool's outputs to the pool
      const fields = toolOutputFields.get(tool.name) ?? [];
      for (const f of fields) allPriorFields.add(f);
    }

    // Format notes into learnedNotes text
    const existing = skill.learnedNotes ? `${skill.learnedNotes}\n` : '';
    const probeDate = new Date().toISOString().slice(0, 10);

    const noteLines: string[] = [`- [${probeDate}] Probe results:`];
    for (const n of notes) {
      if (n.status === 'ok') {
        noteLines.push(`  ✓ ${n.tool}: response fields: ${(n.responseFields ?? []).slice(0, 12).join(', ')}`);
      } else if (n.status === 'error') {
        noteLines.push(`  ✗ ${n.tool}: ${n.error}`);
      } else {
        noteLines.push(`  – ${n.tool}: skipped (${n.error})`);
      }
    }
    if (mismatches.length) {
      noteLines.push('  Chain warnings:');
      for (const m of mismatches) noteLines.push(`    ⚠ ${m}`);
    }

    const newNote = noteLines.join('\n');
    await this.prisma.skill.update({
      where: { id: skillId },
      data: { learnedNotes: `${existing}${newNote}` },
    });

    console.info(`[prober] Probed skill ${skillId}: ${notes.filter((n) => n.status === 'ok').length}/${notes.length} tools OK`);
  }
}
