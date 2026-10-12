import pdfParse from 'pdf-parse';

export type ParsedKnowledge = {
  type: 'openapi' | 'pdf' | 'markdown' | 'url';
  content: string;
  title?: string;
};

/**
 * Parses an OpenAPI 3.x JSON into a detailed textual summary including
 * real parameter schemas, so the LLM can generate accurate tool definitions
 * without guessing field names or types.
 */
export function parseOpenApi(json: Record<string, unknown>): ParsedKnowledge {
  const info = (json['info'] as Record<string, string> | undefined) ?? {};
  const paths = (json['paths'] as Record<string, unknown> | undefined) ?? {};
  const components = (json['components'] as Record<string, unknown> | undefined) ?? {};
  const schemas = (components['schemas'] as Record<string, unknown> | undefined) ?? {};

  function resolveRef(ref: string): Record<string, unknown> {
    const parts = ref.replace('#/', '').split('/');
    let obj: Record<string, unknown> = json;
    for (const p of parts) obj = (obj[p] as Record<string, unknown>) ?? {};
    return obj;
  }

  function describeSchema(schema: Record<string, unknown>, depth = 0): string {
    if (!schema || depth > 3) return '';
    if (schema['$ref']) {
      const resolved = resolveRef(schema['$ref'] as string);
      return describeSchema(resolved, depth + 1);
    }
    const type = (schema['type'] as string) ?? 'object';
    const description = schema['description'] as string | undefined;
    if (type === 'object' && schema['properties']) {
      const props = schema['properties'] as Record<string, unknown>;
      const required = (schema['required'] as string[]) ?? [];
      return Object.entries(props)
        .map(([k, v]) => {
          const prop = v as Record<string, unknown>;
          const propType = prop['$ref'] ? 'object' : ((prop['type'] as string) ?? 'any');
          const req = required.includes(k) ? ' [required]' : '';
          const desc = prop['description'] as string | undefined;
          return `${k}: ${propType}${req}${desc ? ` — ${desc}` : ''}`;
        })
        .join(', ');
    }
    return `${type}${description ? ` — ${description}` : ''}`;
  }

  const operations: string[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method) === -1) continue;
      const operation = op as Record<string, unknown>;
      const summary = (operation['summary'] as string | undefined) ?? '';
      const operationId = (operation['operationId'] as string | undefined) ?? '';
      const description = (operation['description'] as string | undefined) ?? '';

      const paramLines: string[] = [];

      // Query/path/header parameters
      const params = (operation['parameters'] as Array<Record<string, unknown>>) ?? [];
      for (const p of params) {
        const name = p['name'] as string;
        const inLoc = p['in'] as string;
        const req = p['required'] ? '[required]' : '[optional]';
        const schema = (p['schema'] as Record<string, unknown>) ?? {};
        const pType = schema['$ref'] ? 'object' : ((schema['type'] as string) ?? 'string');
        const desc = p['description'] as string | undefined;
        paramLines.push(`  param ${name} (${inLoc}, ${pType}) ${req}${desc ? ` — ${desc}` : ''}`);
      }

      // Request body schema
      const requestBody = operation['requestBody'] as Record<string, unknown> | undefined;
      if (requestBody) {
        const content = requestBody['content'] as Record<string, unknown> | undefined;
        const jsonContent = content?.['application/json'] as Record<string, unknown> | undefined;
        const bodySchema = jsonContent?.['schema'] as Record<string, unknown> | undefined;
        if (bodySchema) {
          const resolved = bodySchema['$ref'] ? resolveRef(bodySchema['$ref'] as string) : bodySchema;
          const desc = describeSchema(resolved);
          if (desc) paramLines.push(`  body fields: ${desc}`);
        }
      }

      // Response schema (200/201)
      const responses = operation['responses'] as Record<string, unknown> | undefined;
      const successResp = responses?.['200'] ?? responses?.['201'] as Record<string, unknown> | undefined;
      if (successResp) {
        const rc = successResp as Record<string, unknown>;
        const content = rc['content'] as Record<string, unknown> | undefined;
        const jsonContent = content?.['application/json'] as Record<string, unknown> | undefined;
        const respSchema = jsonContent?.['schema'] as Record<string, unknown> | undefined;
        if (respSchema) {
          const resolved = respSchema['$ref'] ? resolveRef(respSchema['$ref'] as string) : respSchema;
          const desc = describeSchema(resolved);
          if (desc) paramLines.push(`  response fields: ${desc}`);
        }
      }

      operations.push(
        [
          `${method.toUpperCase()} ${path} [${operationId}]`,
          summary || description ? `  summary: ${summary || description}` : null,
          ...paramLines,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }

  const content = [
    `API: ${info['title'] ?? 'Unknown'} v${info['version'] ?? '?'}`,
    `Description: ${info['description'] ?? 'N/A'}`,
    ``,
    `Endpoints (with real parameter schemas):`,
    ...operations.map((op) => op),
  ].join('\n\n');

  return {
    type: 'openapi',
    content,
    ...(info['title'] ? { title: info['title'] } : {}),
  };
}

/**
 * Extracts text from a PDF buffer for LLM context.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedKnowledge> {
  const data = await pdfParse(buffer);
  const title = data.info?.Title as string | undefined;
  return {
    type: 'pdf',
    content: data.text.slice(0, 50_000),
    ...(title ? { title } : {}),
  };
}

/**
 * Returns markdown content as-is (already text).
 */
export function parseMarkdown(content: string): ParsedKnowledge {
  return { type: 'markdown', content };
}

/**
 * Fetches a URL and returns its text content.
 */
export async function parseUrl(url: string): Promise<ParsedKnowledge> {
  const { fetch } = await import('undici');
  const res = await fetch(url);
  const text = await res.text();
  return { type: 'url', content: text.slice(0, 50_000), title: url };
}

// ─── Document reference types ─────────────────────────────────────────────────

export type DocRefType = 'api_guide' | 'cli' | 'troubleshooting' | 'release_notes' | 'user_guide' | 'other';

export type DocRef = {
  url: string;
  title: string;
  type: DocRefType;
  description: string;
  discoveredAt: string;
};

const DOC_TYPE_PATTERNS: Array<[DocRefType, RegExp]> = [
  ['cli',            /\b(cli|command.?line|cmd)\b/i],
  ['troubleshooting', /\b(troubleshoot|diagnos|debug|error|fix|issue)\b/i],
  ['release_notes',  /\b(release.?note|changelog|what.s.new|version)\b/i],
  ['api_guide',      /\b(api|rest|swagger|openapi|endpoint)\b/i],
  ['user_guide',     /\b(user.?guide|administration|admin|getting.?started|quickstart)\b/i],
];

function classifyDocUrl(url: string, title: string): DocRefType {
  const text = `${url} ${title}`.toLowerCase();
  for (const [type, pattern] of DOC_TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'other';
}

/**
 * Fetches a documentation page and discovers all linked documentation references
 * on the same host. Returns a deduplicated, categorised list of DocRefs.
 * Used to populate DomainKnowledge.docIndex when building a skill.
 */
export async function discoverLinkedDocs(sourceUrl: string): Promise<DocRef[]> {
  try {
    const { fetch } = await import('undici');
    const base = new URL(sourceUrl);
    const res = await fetch(sourceUrl, { headers: { 'User-Agent': 'BEX-SkillBuilder/1.0' } });
    if (!res.ok) return [];
    const html = await res.text();

    // Extract all <a href="..."> links
    const hrefPattern = /href="([^"]+)"/gi;
    const titlePattern = /href="[^"]+">([^<]{3,80})</gi;
    const seen = new Set<string>();
    const refs: DocRef[] = [];

    // Match href + immediately following anchor text together
    const anchorPattern = /<a\s[^>]*href="([^"]+)"[^>]*>([^<]{2,80})<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = anchorPattern.exec(html)) !== null) {
      const rawUrl = match[1]!.trim();
      const linkText = match[2]!.replace(/\s+/g, ' ').trim();

      let resolved: URL;
      try {
        resolved = new URL(rawUrl, base);
      } catch {
        continue;
      }
      // Allowlist: only follow http/https links (blocks javascript:, data:, file:, etc.)
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;

      // Only same host
      if (resolved.hostname !== base.hostname) continue;
      // Skip source URL itself
      if (resolved.href === base.href) continue;
      // Skip image/asset URLs
      if (/\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|ttf)(\?|$)/i.test(resolved.pathname)) continue;

      const canonical = resolved.href.split('#')[0]!;
      if (seen.has(canonical)) continue;
      seen.add(canonical);

      const type = classifyDocUrl(canonical, linkText);
      refs.push({
        url: canonical,
        title: linkText,
        type,
        description: `Discovered from ${sourceUrl}`,
        discoveredAt: new Date().toISOString(),
      });
    }

    // If anchor regex missed some (malformed HTML), fall back to bare href extraction
    if (refs.length === 0) {
      let m: RegExpExecArray | null;
      while ((m = hrefPattern.exec(html)) !== null) {
        const rawUrl = m[1]!.trim();
        if (!rawUrl || rawUrl.startsWith('#') || rawUrl.startsWith('mailto:')) continue;
        try {
          const resolved = new URL(rawUrl, base);
          if (resolved.hostname !== base.hostname) continue;
          const canonical = resolved.href.split('#')[0]!;
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          refs.push({ url: canonical, title: canonical, type: classifyDocUrl(canonical, ''), description: '', discoveredAt: new Date().toISOString() });
        } catch { /* skip */ }
      }
      void titlePattern; // suppress unused warning
    }

    // Deduplicate keeping the highest-confidence entry per URL
    return refs.slice(0, 100); // cap at 100 refs
  } catch {
    return [];
  }
}

