import { Router } from 'express';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';
import { createEndpoint } from '../db/repos/endpoints.repo.js';
import { generateWebhookSecret, encryptWebhookSecret } from '../webhooks/secret-manager.js';
import { findOrCreateAccountForUser, findAccountById } from '../db/repos/accounts.repo.js';

export const connectionsRouter = Router();

const isProd = process.env.NODE_ENV === 'production';

connectionsRouter.post('/webhook/generate', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const { connectorId } = req.body ?? {};
  let { accountId } = req.body ?? {};
  if (!connectorId) return res.status(400).json({ error: 'connectorId requis' });

  // En prod (ou si connecté), on force l'utilisation du compte de l'utilisateur
  if (req.userId) {
    const acc = findOrCreateAccountForUser(req.userId);
    accountId = acc.id;
  } else {
    // Dev fallback: compte libre autorisé
    if (!accountId) return res.status(400).json({ error: 'accountId requis en dev sans auth' });
  }

  const secret = generateWebhookSecret();
  const encrypted = encryptWebhookSecret(secret);
  const result = createEndpoint(accountId, connectorId, encrypted);
  const url = `${req.protocol}://${req.get('host')}/webhooks/w/${result.pathToken}`;
  return res.json({
    ok: true,
    url,
    pathToken: result.pathToken,
    secret, // Afficher une seule fois
    accountId,
    warning: 'Conservez ce secret en lieu sûr. Il ne sera plus affiché.',
  });
});
