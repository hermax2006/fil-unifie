import express from 'express';
import { config } from './config/index.js';
import { apiRouter } from './routes/api.js';
import { webhooksRouter } from './webhooks/router.js';
import { migrate } from './db/client.js';

migrate();

const app = express();

// On garde le corps brut : indispensable pour vérifier les signatures (Slack, etc.).
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));

app.use('/api', apiRouter);
app.use('/webhooks', webhooksRouter);

app.listen(config.port, () => {
  console.log(`Serveur sur http://localhost:${config.port}`);
});
