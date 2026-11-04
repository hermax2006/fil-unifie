import { Router } from 'express';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';
import { createEndpoint } from '../db/repos/endpoints.repo.js';
import { generateWebhookSecret, encryptWebhookSecret } from '../webhooks/secret-manager.js';

export const connectionsRouter = Router();

const isProd = process.env.NODE_ENV === 'production';

connectionsRouter.post('/webhook/generate', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const { accountId, connectorId } = req.body ?? {};
  if (!accountId || !connectorId) return res.status(400).json({ error: 'accountId et connectorId requis' });
  const secret = generateWebhookSecret();
  const encrypted = encryptWebhookSecret(secret);
  const result = createEndpoint(accountId, connectorId, encrypted);
  const url = `${req.protocol}://${req.get('host')}/webhooks/w/${result.pathToken}`;
  return res.json({
    ok: true,
    url,
    pathToken: result.pathToken,
    secret, // Afficher une seule fois
    warning: 'Conservez ce secret en lieu sûr. Il ne sera plus affiché.',
  });
});
