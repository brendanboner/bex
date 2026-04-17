import { z } from 'zod';
import type { CoreTool } from 'ai';
import { KnowledgeStore } from './store.js';

export function makeReadKnowledgeTool(store: KnowledgeStore): CoreTool {
  return {
    description:
      'Read a markdown knowledge/configuration file for a domain. Returns the file content.',
    parameters: z.object({
      domain: z
        .string()
        .describe('Domain identifier, e.g. networking.extreme-xco'),
      topic: z
        .string()
        .describe('Topic name, e.g. topology, endpoints, credentials-guide'),
    }),
    execute: async ({ domain, topic }: { domain: string; topic: string }) => {
      const entry = await store.read(domain, topic);
      if (!entry) return { found: false, content: null };
      return { found: true, content: entry.content, updatedAt: entry.updatedAt };
    },
  };
}

export function makeWriteKnowledgeTool(store: KnowledgeStore): CoreTool {
  return {
    description:
      'Write or update a markdown knowledge/configuration file for a domain.',
    parameters: z.object({
      domain: z.string().describe('Domain identifier, e.g. networking.extreme-xco'),
      topic: z.string().describe('Topic name, e.g. topology, endpoints'),
      content: z.string().describe('Full markdown content to write'),
    }),
    execute: async ({ domain, topic, content }: { domain: string; topic: string; content: string }) => {
      const entry = await store.write(domain, topic, content);
      return { ok: true, path: entry.domain + '/' + entry.topic + '.md', updatedAt: entry.updatedAt };
    },
  };
}

export function makeListKnowledgeTopicsTool(store: KnowledgeStore): CoreTool {
  return {
    description: 'List available knowledge files, optionally filtered by domain.',
    parameters: z.object({
      domain: z
        .string()
        .optional()
        .describe('Optional domain to filter by, e.g. networking.extreme-xco'),
    }),
    execute: async ({ domain }: { domain?: string }) => {
      const topics = await store.list(domain);
      return { topics };
    },
  };
}

export function makeSearchKnowledgeTool(store: KnowledgeStore): CoreTool {
  return {
    description: 'Search across all knowledge files for a query string.',
    parameters: z.object({
      query: z.string().describe('Text to search for across all knowledge files'),
      domain: z
        .string()
        .optional()
        .describe('Optional domain to restrict search to'),
    }),
    execute: async ({ query, domain }: { query: string; domain?: string }) => {
      const matches = await store.search(query, domain);
      return { matches };
    },
  };
}
