import type { Express, NextFunction, Request, Response } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { config } from '../config/index.js';
import { QUEUE_NAME, DLQ_NAME, redisConnectionOptions, requeueDeadLetters } from './index.js';

function readBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

/**
 * Protection du dashboard :
 * - dev : ouvert si QUEUE_ADMIN_USER/PASS ne sont pas définis.
 * - prod : identifiants obligatoires, sinon 503.
 */
function adminAuth(req: Request, res: Response, next: NextFunction) {
  const expectedUser = process.env.QUEUE_ADMIN_USER;
  const expectedPass = process.env.QUEUE_ADMIN_PASS;

  if (!expectedUser || !expectedPass) {
    if (!config.isProd) return next();
    return res.status(503).json({ error: 'QUEUE_ADMIN_USER et QUEUE_ADMIN_PASS requis en production' });
  }

  const given = readBasicAuth(req.headers.authorization);
  if (!given) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Queues"');
    return res.status(401).send('Authentification requise');
  }
  if (given.user === expectedUser && given.pass === expectedPass) return next();

  res.setHeader('WWW-Authenticate', 'Basic realm="Queues"');
  return res.status(401).send('Identifiants invalides');
}

/** Monte Bull Board sur /admin/queues (uniquement avec BullMQ). */
export function mountQueueDashboard(app: Express): void {
  if (config.queueDriver !== 'bullmq') {
    console.log('Dashboard BullMQ désactivé (QUEUE_DRIVER=memory)');
    return;
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const mainQueue = new Queue(QUEUE_NAME, { connection: redisConnectionOptions() });
  const deadLetterQueue = new Queue(DLQ_NAME, { connection: redisConnectionOptions() });

  createBullBoard({
    queues: [new BullMQAdapter(mainQueue), new BullMQAdapter(deadLetterQueue)],
    serverAdapter,
  });

  // Doit être déclaré avant le routeur du dashboard.
  app.post('/admin/queues/requeue-dlq', adminAuth, async (_req, res) => {
    try {
      const count = await requeueDeadLetters();
      res.json({ ok: true, count });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.use('/admin/queues', adminAuth, serverAdapter.getRouter());
  console.log('Dashboard files : http://localhost:' + config.port + '/admin/queues');
}
