import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../connectors/registry.js';
import { listEvents, markEventRead } from '../db/events.store.js';
import { sseHandler } from '../sse/index.js';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';
import { validateQuery } from '../utils/validate.js';

export const apiRouter = Router();
const isProd = process.env.NODE_ENV === 'production';

apiRouter.get('/health', (_req, res) => void res.json({ ok: true }));
apiRouter.get('/connectors', (_req, res) => void res.json(registry.catalog()));

const eventsQuery = z.object({
  connector: z.string().optional(),
  kind: z.enum(['message', 'mention', 'notification', 'task', 'other']).optional(),
  read: z.enum(['all', 'read', 'unread']).optional().default('all'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

// En prod: auth obligatoire. En dev: on attache l'utilisateur si présent.
apiRouter.get('/events', isProd ? requireAuth : attachUser, validateQuery(eventsQuery), (req: AuthRequest, res) => {
  const q = (req as any).validatedQuery as z.infer<typeof eventsQuery>;
  void res.json(listEvents(q.limit, req.userId, { connector: q.connector, kind: q.kind, read: q.read }));
});

apiRouter.post('/events/:id/read', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = markEventRead(id, req.userId);
  if (!ok) return void res.status(404).json({ error: 'événement introuvable' });
  void res.json({ ok: true });
});

apiRouter.get('/stream', sseHandler);
