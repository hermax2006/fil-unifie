import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

// Charger .env depuis la racine du projet (4-/) si présent
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { apiRouter } from './routes/api.js';
import { webhooksRouter } from './webhooks/router.js';
import { authRouter } from './routes/auth.js';
import { connectionsRouter } from './routes/connections.js';
import { migrate } from './db/client.js';

migrate();

const app = express();

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
app.use('/api/connections', connectionsRouter);
app.use('/api', apiRouter);
app.use('/webhooks', webhooksRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.message?.startsWith('CORS:')) return res.status(403).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'erreur serveur' });
});

app.listen(config.port, () => {
  console.log(`Serveur sur http://localhost:${config.port}`);
});

/*
 * POINT D'ENTRÉE DU SERVEUR
 * ------------------------
 * 1. On exécute les migrations SQLite au démarrage
 * 2. On configure Express (JSON avec rawBody pour vérifier signatures HMAC)
 * 3. On monte les routes : /auth, /api, /webhooks
 * 4. Le serveur écoute sur le port configuré
 */
