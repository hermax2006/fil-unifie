import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { apiRouter } from './routes/api.js';
import { webhooksRouter } from './webhooks/router.js';
import { authRouter } from './routes/auth.js';
import { connectionsRouter } from './routes/connections.js';
import { migrate } from './db/client.js';

migrate();

const app = express();

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
