import { Router } from 'express';
import { registry } from '../connectors/registry.js';
import { listEvents } from '../db/events.store.js';
import { sseHandler } from '../sse/index.js';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';

export const apiRouter = Router();
const isProd = process.env.NODE_ENV === 'production';

apiRouter.get('/health', (_req, res) => void res.json({ ok: true }));
apiRouter.get('/connectors', (_req, res) => void res.json(registry.catalog()));

// En prod: auth obligatoire. En dev: on attache l'utilisateur si présent.
apiRouter.get('/events', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  void res.json(listEvents(100, req.userId));
});
apiRouter.get('/stream', sseHandler);
