import pdfParse from 'pdf-parse';

export type ParsedKnowledge = {
  type: 'openapi' | 'pdf' | 'markdown' | 'url';
  content: string;
  title?: string;
};

/**
 * Parses an OpenAPI 3.x JSON into a condensed textual summary suitable for
 * use as LLM context when generating skill definitions.
 */
export function parseOpenApi(json: Record<string, unknown>): ParsedKnowledge {
  const info = (json['info'] as Record<string, string> | undefined) ?? {};
  const paths = (json['paths'] as Record<string, unknown> | undefined) ?? {};

  const operations: string[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      const operation = op as Record<string, unknown>;
      const summary = (operation['summary'] as string | undefined) ?? '';
      const operationId = (operation['operationId'] as string | undefined) ?? '';
      operations.push(`${method.toUpperCase()} ${path} - ${operationId}: ${summary}`);
    }
  }

  const content = [
    `API: ${info['title'] ?? 'Unknown'} v${info['version'] ?? '?'}`,
    `Description: ${info['description'] ?? 'N/A'}`,
    ``,
    `Endpoints:`,
    ...operations.map((op) => `  ${op}`),
  ].join('\n');

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
