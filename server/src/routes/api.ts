import { Router } from 'express';
import { registry } from '../connectors/registry.js';
import { listEvents } from '../db/events.store.js';
import { sseHandler } from '../sse/index.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => void res.json({ ok: true }));
apiRouter.get('/connectors', (_req, res) => void res.json(registry.catalog()));
apiRouter.get('/events', (_req, res) => void res.json(listEvents()));
apiRouter.get('/stream', sseHandler);
