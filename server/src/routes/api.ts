import { Router } from 'express';
import { registry } from '../connectors/registry.js';
import { listEvents, markEventRead } from '../db/events.store.js';
import { sseHandler } from '../sse/index.js';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';

export const apiRouter = Router();
const isProd = process.env.NODE_ENV === 'production';

apiRouter.get('/health', (_req, res) => void res.json({ ok: true }));
apiRouter.get('/connectors', (_req, res) => void res.json(registry.catalog()));

// En prod: auth obligatoire. En dev: on attache l'utilisateur si présent.
apiRouter.get('/events', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const { connector, kind, read } = req.query as Record<string, string | undefined>;
  const filters = {
    connector: connector || undefined,
    kind: kind || undefined,
    read: (read === 'read' || read === 'unread') ? read : 'all',
  } as const;
  void res.json(listEvents(100, req.userId, filters));
});

apiRouter.post('/events/:id/read', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = markEventRead(id, req.userId);
  if (!ok) return void res.status(404).json({ error: 'événement introuvable' });
  void res.json({ ok: true });
});

apiRouter.get('/stream', sseHandler);
