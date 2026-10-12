import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseOpenApi } from '../src/knowledge-parser.js';

describe('knowledge-parser', () => {
  describe('parseOpenApi', () => {
    it('extracts title and endpoint list from an OpenAPI document', () => {
      const doc = {
        info: { title: 'XCO API', version: '1.0', description: 'Extreme XCO REST API' },
        paths: {
          '/devices': {
            get: { operationId: 'listDevices', summary: 'List all devices' },
            post: { operationId: 'createDevice', summary: 'Create a device' },
          },
          '/vlans': {
            get: { operationId: 'listVlans', summary: 'List VLANs' },
          },
        },
      };

      const result = parseOpenApi(doc);

      expect(result.type).toBe('openapi');
      expect(result.title).toBe('XCO API');
      expect(result.content).toContain('XCO API v1.0');
      expect(result.content).toContain('GET /devices [listDevices]');
      expect(result.content).toContain('List all devices');
      expect(result.content).toContain('POST /devices [createDevice]');
      expect(result.content).toContain('Create a device');
      expect(result.content).toContain('GET /vlans [listVlans]');
      expect(result.content).toContain('List VLANs');
    });

    it('handles missing info and paths gracefully', () => {
      const result = parseOpenApi({});
      expect(result.type).toBe('openapi');
      expect(result.content).toContain('API: Unknown');
    });
  });

  describe('parseMarkdown', () => {
    it('returns markdown content as-is', () => {
      const md = '## Setup\n\nUse Bearer token for auth.';
      const result = parseMarkdown(md);
      expect(result.type).toBe('markdown');
      expect(result.content).toBe(md);
    });
  });
});
