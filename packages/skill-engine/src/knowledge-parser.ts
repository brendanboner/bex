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
