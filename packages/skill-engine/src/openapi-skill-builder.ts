/**
 * openapi-skill-builder.ts
 *
 * Parses an OpenAPI 3.x spec and generates Forge skill definitions grouped by tag.
 * Each tag becomes a skill with tools for each operation.
 * GET operations → handlerType: 'xciq_http_call' (or configurable)
 * POST/PUT/PATCH/DELETE → same handler, but marked as write ops (require approval)
 */

export interface OpenApiParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: { type?: string; format?: string };
}

export interface OpenApiOperation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters: OpenApiParam[];
  requestBodySchema?: Record<string, unknown>;
  isWrite: boolean;
}

export interface GeneratedTool {
  name: string;
  description: string;
  handlerType: string;
  config: {
    loginUrl?: string;
    method: string;
    urlTemplate: string;
    isWrite: boolean;
    operationId: string;
  };
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface GeneratedSkill {
  name: string;
  domain: string;
  description: string;
  version: string;
  capabilities: string[];
  systemPrompt: string;
  tools: GeneratedTool[];
  requiresApprovalForWrites: boolean;
  source: string; // original spec URL
}

/** Sanitise an operation ID or summary into a valid tool name (snake_case, ≤64 chars) */
function toToolName(opId: string, method: string, path: string): string {
  const base = opId || `${method.toLowerCase()}_${path.replace(/\//g, '_').replace(/[{}]/g, '').replace(/^_/, '')}`;
  return base
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '')
    .slice(0, 64);
}

/** Convert a tag name to a domain slug */
function toDomain(prefix: string, tag: string): string {
  return `${prefix}.${tag
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '.')
    .replace(/-/g, '.')
    .replace(/\.+/g, '.')}`;
}

/** Build a urlTemplate from path + query params */
function buildUrlTemplate(baseUrl: string, path: string, params: OpenApiParam[]): string {
  // Rewrite {id} style path params (already compatible)
  const pathWithTemplate = path; // OpenAPI uses {param} which matches our template format
  const queryParams = params.filter(p => p.in === 'query');
  if (queryParams.length === 0) return `${baseUrl}${pathWithTemplate}`;
  const qs = queryParams.map(p => `${p.name}={${p.name}}`).join('&');
  return `${baseUrl}${pathWithTemplate}?${qs}`;
}

/** Extract parameter schema from an operation for the tool definition */
function buildParamSchema(op: OpenApiOperation): GeneratedTool['parameters'] {
  const props: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];

  for (const p of op.parameters) {
    props[p.name] = {
      type: p.schema?.type ?? 'string',
      description: p.description ?? `${p.in} parameter: ${p.name}`,
    };
    if (p.required && p.in !== 'path') required.push(p.name);
  }

  // For path params, they are always required
  for (const p of op.parameters.filter(x => x.in === 'path')) {
    if (!required.includes(p.name)) required.push(p.name);
  }

  // Add body params for write operations
  if (op.isWrite && op.requestBodySchema) {
    const bodyProps = (op.requestBodySchema as any)?.properties ?? {};
    for (const [key, val] of Object.entries(bodyProps as Record<string, any>)) {
      if (!props[key]) {
        props[key] = {
          type: val.type ?? 'string',
          description: val.description ?? key,
        };
      }
    }
  }

  return { type: 'object', properties: props, required };
}

export interface BuildSkillsOptions {
  specUrl: string;
  baseUrl: string;
  loginUrl?: string;
  handlerType?: string;
  domainPrefix: string;
  /** Tags to include (if empty, include all) */
  includeTags?: string[];
  /** Tags to exclude */
  excludeTags?: string[];
  /** Max tools per skill (split large tags) */
  maxToolsPerSkill?: number;
  /** Spec JSON (if already fetched) */
  spec?: Record<string, unknown>;
}

export async function buildSkillsFromOpenApi(opts: BuildSkillsOptions): Promise<GeneratedSkill[]> {
  const {
    specUrl,
    baseUrl,
    loginUrl,
    handlerType = 'xciq_http_call',
    domainPrefix,
    includeTags = [],
    excludeTags = [],
    maxToolsPerSkill = 40,
  } = opts;

  // Fetch spec if not provided
  let spec: Record<string, unknown>;
  if (opts.spec) {
    spec = opts.spec;
  } else {
    const { fetch } = await import('undici');
    const res = await fetch(specUrl);
    spec = await res.json() as Record<string, unknown>;
  }

  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const specBaseUrl = ((spec.servers as any)?.[0]?.url ?? baseUrl).replace(/\/$/, '');
  const effectiveBaseUrl = baseUrl || specBaseUrl;
  const effectiveLoginUrl = loginUrl ?? `${effectiveBaseUrl}/login`;

  // Collect all operations grouped by tag
  const tagOps = new Map<string, OpenApiOperation[]>();

  for (const [path, methodMap] of Object.entries(paths)) {
    for (const [method, rawOp] of Object.entries(methodMap)) {
      const op = rawOp as Record<string, unknown>;
      const opTags: string[] = (op.tags as string[]) ?? ['Misc'];
      const isWrite = !['get', 'head', 'options'].includes(method.toLowerCase());

      // Resolve request body schema
      let requestBodySchema: Record<string, unknown> | undefined;
      const requestBody = op.requestBody as any;
      if (requestBody) {
        const jsonSchema = requestBody.content?.['application/json']?.schema;
        if (jsonSchema) {
          // Dereference simple $ref if possible
          requestBodySchema = jsonSchema;
        }
      }

      const operation: OpenApiOperation = {
        method: method.toUpperCase() as OpenApiOperation['method'],
        path,
        operationId: (op.operationId as string) ?? '',
        summary: (op.summary as string) ?? '',
        ...(op.description !== undefined ? { description: op.description as string } : {}),
        tags: opTags,
        parameters: (op.parameters as OpenApiParam[]) ?? [],
        ...(requestBodySchema !== undefined ? { requestBodySchema } : {}),
        isWrite,
      };

      for (const tag of opTags) {
        if (includeTags.length > 0 && !includeTags.includes(tag)) continue;
        if (excludeTags.includes(tag)) continue;
        if (!tagOps.has(tag)) tagOps.set(tag, []);
        tagOps.get(tag)!.push(operation);
      }
    }
  }

  const skills: GeneratedSkill[] = [];

  for (const [tag, ops] of tagOps) {
    // Split if too many tools
    const chunks: OpenApiOperation[][] = [];
    for (let i = 0; i < ops.length; i += maxToolsPerSkill) {
      chunks.push(ops.slice(i, i + maxToolsPerSkill));
    }

    chunks.forEach((chunk, chunkIdx) => {
      const hasWrites = chunk.some(o => o.isWrite);
      const suffix = chunks.length > 1 ? `.part${chunkIdx + 1}` : '';
      const domain = toDomain(domainPrefix, tag) + suffix;
      const skillName = tag + (chunks.length > 1 ? ` (Part ${chunkIdx + 1})` : '');

      const tools: GeneratedTool[] = chunk.map(op => {
        const name = toToolName(op.operationId, op.method, op.path);
        const urlTemplate = buildUrlTemplate(effectiveBaseUrl, op.path, op.parameters);

        return {
          name,
          description: `[${op.method}] ${op.summary || op.path}${op.isWrite ? ' ⚠️ WRITE OPERATION — requires approval' : ''}`,
          handlerType,
          config: {
            loginUrl: effectiveLoginUrl,
            method: op.method,
            urlTemplate,
            isWrite: op.isWrite,
            operationId: op.operationId,
          },
          parameters: buildParamSchema(op),
        };
      });

      const readOps = chunk.filter(o => !o.isWrite);
      const writeOps = chunk.filter(o => o.isWrite);
      const capabilities = [
        ...readOps.slice(0, 5).map(o => o.summary).filter(Boolean),
        ...writeOps.slice(0, 3).map(o => o.summary).filter(Boolean),
      ];

      skills.push({
        name: skillName,
        domain,
        description: `ExtremeCloud IQ — ${tag}. ${readOps.length} read operations, ${writeOps.length} write operations.`,
        version: '1.0.0',
        capabilities: capabilities.length > 0 ? capabilities : [tag],
        systemPrompt: buildSkillSystemPrompt(tag, chunk, readOps, writeOps, effectiveBaseUrl),
        tools,
        requiresApprovalForWrites: hasWrites,
        source: specUrl,
      });
    });
  }

  return skills;
}

/**
 * Generate a rich, context-aware system prompt from the OpenAPI operations.
 * Extracts:
 *   - List of read vs write operations
 *   - Pagination patterns (detected from 'page'/'limit' params)
 *   - Search/filter patterns (detected from 'searchString'/'filter' params)
 *   - ID-chaining patterns (when GET list ops have IDs the agent needs to use)
 *   - Write safety guidance
 */
function buildSkillSystemPrompt(
  tag: string,
  allOps: OpenApiOperation[],
  readOps: OpenApiOperation[],
  writeOps: OpenApiOperation[],
  baseUrl: string,
): string {
  const lines: string[] = [];
  lines.push(`You manage ${baseUrl.includes('extremecloudiq') ? 'ExtremeCloud IQ' : baseUrl} — ${tag}.`);
  lines.push('');

  // ── Operation counts ──
  lines.push(`READ ops (${readOps.length}): Execute freely.`);
  if (writeOps.length > 0) {
    lines.push(`WRITE ops (${writeOps.length}): Always describe the change and get explicit user confirmation before POST/PUT/PATCH/DELETE.`);
  }
  lines.push('');

  // ── Pagination detection ──
  const paginatedOps = readOps.filter(op =>
    op.parameters.some(p => p.name === 'page' || p.name === 'limit' || p.name === 'pageSize'),
  );
  if (paginatedOps.length > 0) {
    lines.push('PAGINATION:');
    lines.push('- API responses contain: page, count, total_pages, total_count, data[]');
    lines.push('- Always pass limit=100 for comprehensive results (default is often 10).');
    lines.push('- If total_count > count, there are more pages — fetch them with page=2, 3, etc.');
    lines.push('');
  }

  // ── Search/filter pattern detection ──
  const searchOps = readOps.filter(op =>
    op.parameters.some(p => p.name === 'searchString' || p.name === 'search' || p.name === 'keyword'),
  );
  if (searchOps.length > 0) {
    const searchParamOps = searchOps.map(op => {
      const sp = op.parameters.find(p => p.name === 'searchString' || p.name === 'search' || p.name === 'keyword');
      return `${op.path} (param: ${sp?.name ?? 'search'})`;
    }).slice(0, 3);
    lines.push('SEARCH:');
    lines.push(`- Use searchString/keyword for hostname/name-based search: ${searchParamOps.join('; ')}`);
    lines.push('- Name/hostname filters are typically EXACT MATCH — use searchString for partial matches.');
    lines.push('');
  }

  // ── ID-chaining guidance ──
  const listOps = readOps.filter(op => op.summary.toLowerCase().startsWith('list') || op.summary.toLowerCase().startsWith('get all'));
  const getByIdOps = readOps.filter(op => op.parameters.some(p => p.in === 'path' && (p.name === 'id' || p.name.endsWith('Id') || p.name.endsWith('ID'))));
  if (listOps.length > 0 && getByIdOps.length > 0) {
    lines.push('ID CHAINING:');
    lines.push('- Always use list_* first to get numeric IDs, then pass those IDs to get_* or filter operations.');
    lines.push('- Name-based filters require exact match — if unsure of exact name, list first and match client-side.');
    lines.push('');
  }

  // ── Write safety ──
  if (writeOps.length > 0) {
    const writeNames = writeOps.slice(0, 5).map(op => op.summary || op.operationId).filter(Boolean);
    lines.push('WRITE SAFETY:');
    lines.push(`- Write operations include: ${writeNames.join(', ')}${writeOps.length > 5 ? ` and ${writeOps.length - 5} more` : ''}.`);
    lines.push('- Before any write: state what will change, which resources are affected, and confirm with user.');
    lines.push('- If write fails: do NOT retry automatically — report the error and ask for guidance.');
    lines.push('');
  }

  // ── Context guidance ──
  lines.push('RESULT PRESENTATION:');
  lines.push('- For lists: show key fields (hostname, IP, MAC, status). Summarise total count.');
  lines.push('- For errors: show HTTP status code and error message from the response body.');
  lines.push('- If a filter returns 0 results but you expect data: try broader search or list all then filter client-side.');
  lines.push('- Use skill_add_note tool to save any API behaviour you discover that differs from documentation.');

  return lines.join('\n');
}
