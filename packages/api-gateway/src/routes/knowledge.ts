import type { FastifyInstance } from 'fastify';
import { KnowledgeStore } from '@bex/knowledge-store';
import { ok, err, ErrorCodes } from '@bex/shared';

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  const baseDir = process.env['KNOWLEDGE_BASE_DIR'] ?? './knowledge';
  const store = new KnowledgeStore(baseDir);

  // GET /knowledge/search?q=...
  app.get<{ Querystring: { q?: string; domain?: string } }>(
    '/knowledge/search',
    async (request, reply) => {
      const { q, domain } = request.query;
      if (!q) return reply.status(400).send(err(ErrorCodes.VALIDATION_ERROR, 'q is required'));
      const matches = await store.search(q, domain);
      return reply.send(ok(matches));
    },
  );

  // GET /knowledge — list all topics
  app.get('/knowledge', async (_request, reply) => {
    const topics = await store.list();
    return reply.send(ok(topics));
  });

  // GET /knowledge/:domain — list topics for domain
  app.get<{ Params: { domain: string } }>('/knowledge/:domain', async (request, reply) => {
    const topics = await store.list(request.params.domain);
    return reply.send(ok(topics));
  });

  // GET /knowledge/:domain/:topic — get content
  app.get<{ Params: { domain: string; topic: string } }>(
    '/knowledge/:domain/:topic',
    async (request, reply) => {
      const entry = await store.read(request.params.domain, request.params.topic);
      if (!entry) return reply.status(404).send(err(ErrorCodes.NOT_FOUND, 'Topic not found'));
      return reply.send(ok(entry));
    },
  );

  // PUT /knowledge/:domain/:topic — update content
  app.put<{ Params: { domain: string; topic: string }; Body: unknown }>(
    '/knowledge/:domain/:topic',
    async (request, reply) => {
      const body = request.body as { content?: string };
      if (typeof body?.content !== 'string') {
        return reply
          .status(400)
          .send(err(ErrorCodes.VALIDATION_ERROR, 'body.content is required'));
      }
      const entry = await store.write(request.params.domain, request.params.topic, body.content);
      return reply.send(ok(entry));
    },
  );

  // DELETE /knowledge/:domain/:topic
  app.delete<{ Params: { domain: string; topic: string } }>(
    '/knowledge/:domain/:topic',
    async (request, reply) => {
      await store.delete(request.params.domain, request.params.topic);
      return reply.send(ok({ deleted: true }));
    },
  );
}
