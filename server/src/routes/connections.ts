import { Router } from 'express';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';
import { createEndpoint, listEndpointsForAccount, revokeEndpoint } from '../db/repos/endpoints.repo.js';
import { generateWebhookSecret, encryptWebhookSecret } from '../webhooks/secret-manager.js';
import { findOrCreateAccountForUser } from '../db/repos/accounts.repo.js';

export const connectionsRouter = Router();

const isProd = process.env.NODE_ENV === 'production';

function resolveAccountId(req: AuthRequest, bodyAccountId?: string) {
  if (req.userId) return findOrCreateAccountForUser(req.userId).id;
  if (!isProd && bodyAccountId) return bodyAccountId;
  return null;
}

connectionsRouter.get('/webhook/endpoints', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const accountId = resolveAccountId(req, (req.query.accountId as string) || undefined);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const rows = listEndpointsForAccount(accountId).map((r: any) => ({
    id: r.id,
    connectorId: r.connector_id,
    url: `${req.protocol}://${req.get('host')}/webhooks/w/${r.path_token}`,
    pathToken: r.path_token,
    active: !!r.active,
    createdAt: r.created_at,
  }));
  return res.json(rows);
});

connectionsRouter.post('/webhook/generate', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const { connectorId } = req.body ?? {};
  const accountId = resolveAccountId(req, req.body?.accountId);
  if (!connectorId) return res.status(400).json({ error: 'connectorId requis' });
  if (!accountId) return res.status(400).json({ error: 'accountId requis en dev sans auth' });

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

connectionsRouter.post('/webhook/endpoints/:id/revoke', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const accountId = resolveAccountId(req, req.body?.accountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = revokeEndpoint(id, accountId);
  if (!ok) return res.status(404).json({ error: 'endpoint introuvable' });
  return res.json({ ok: true });
});
