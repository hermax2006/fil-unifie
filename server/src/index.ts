import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { apiRouter } from './routes/api.js';
import { webhooksRouter } from './webhooks/router.js';
import { authRouter } from './routes/auth.js';
import { connectionsRouter } from './routes/connections.js';
import { migrate } from './db/client.js';
import { startPoller, stopPoller } from './queues/poller.js';
import { startQueue, stopQueue } from './queues/index.js';
import { mountQueueDashboard } from './queues/dashboard.js';
import { webhookLimiter, apiLimiter } from './middleware/rate-limit.js';

migrate();

const app = express();
if (config.isProd) app.set('trust proxy', 1);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl/server-to-server
    if (config.allowedOrigins.includes(origin)) return cb(null, true);
    if (!config.isProd && /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
    return cb(new Error('CORS: origine non autorisée'));
  },
  credentials: true,
}));

// On garde le corps brut : indispensable pour vérifier les signatures (Slack, etc.).
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));
app.use(cookieParser());

app.use('/auth', authRouter);
app.use('/api/connections', apiLimiter, connectionsRouter);
app.use('/api', apiLimiter, apiRouter);
app.use('/webhooks', webhookLimiter, webhooksRouter);
mountQueueDashboard(app);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.message?.startsWith('CORS:')) return res.status(403).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'erreur serveur' });
});

app.listen(config.port, () => {
  console.log(`Serveur sur http://localhost:${config.port}`);
  if (process.env.NODE_ENV !== 'test') {
    void startQueue();
    startPoller();
  }
});

async function shutdown() {
  stopPoller();
  await stopQueue();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/*
 * POINT D'ENTRÉE DU SERVEUR
 * ------------------------
 * 1. On exécute les migrations SQLite au démarrage
 * 2. On configure Express (JSON avec rawBody pour vérifier signatures HMAC)
 * 3. On monte les routes : /auth, /api, /webhooks
 * 4. Le serveur écoute sur le port configuré
 */
