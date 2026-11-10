import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';
import { createEndpoint, listEndpointsForAccount, revokeEndpoint, rotateEndpointSecret, rotateEndpointToken } from '../db/repos/endpoints.repo.js';
import { generatePathToken, hashPathToken } from '../webhooks/path-token.js';
import { generateWebhookSecret, encryptWebhookSecret } from '../webhooks/secret-manager.js';
import { findOrCreateAccountForUser } from '../db/repos/accounts.repo.js';
import { validateBody } from '../utils/validate.js';
import { registry } from '../connectors/registry.js';
import { updateConnection, setConnectionTokens, getConnection } from '../db/repos/connections.repo.js';
import { getSyncState, getLatestSyncRun } from '../db/repos/sync.repo.js';
import { encryptToken, decryptToken } from '../crypto/tokens.js';

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
    // Le jeton d'URL est haché : impossible de réafficher l'ancienne URL.
    url: null,
    active: !!r.active,
    createdAt: r.created_at,
  }));
  return res.json(rows);
});

const generateSchema = z.object({
  connectorId: z.string().min(1),
  accountId: z.string().optional(),
});

connectionsRouter.post('/webhook/generate', isProd ? requireAuth : attachUser, validateBody(generateSchema), (req: AuthRequest, res) => {
  const { connectorId, accountId: bodyAccountId } = (req as any).validatedBody as z.infer<typeof generateSchema>;
  const accountId = resolveAccountId(req, bodyAccountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis en dev sans auth' });
  if (!registry.get(connectorId)) return res.status(404).json({ error: 'connecteur inconnu' });

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

connectionsRouter.post('/webhook/endpoints/:id/rotate-secret', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const accountId = resolveAccountId(req, req.body?.accountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const secret = generateWebhookSecret();
  const encrypted = encryptWebhookSecret(secret);
  const ok = rotateEndpointSecret(id, accountId, encrypted);
  if (!ok) return res.status(404).json({ error: 'endpoint introuvable ou inactif' });
  return res.json({ ok: true, secret, warning: 'Nouveau secret généré. Il ne sera plus affiché.' });
});

connectionsRouter.get('/connector-connections', isProd ? requireAuth : attachUser, async (req: AuthRequest, res) => {
  const accountId = resolveAccountId(req, (req.query.accountId as string) || undefined);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const { listConnections } = await import('../db/repos/connections.repo.js');
  return res.json(listConnections(accountId).map((c) => {
    const sync = getSyncState(c.id);
    const run = getLatestSyncRun(c.id);
    return {
      id: c.id,
      connectorId: c.connector_id,
      active: !!c.active,
      config: c.config_json ? JSON.parse(c.config_json) : null,
      hasTokens: !!c.encrypted_tokens_json,
      updatedAt: c.updated_at,
      lastPolledAt: sync?.last_polled_at ?? null,
      lastRun: run ? { status: run.status, at: run.finished_at ?? run.started_at, error: run.error } : null,
    };
  }));
});

connectionsRouter.post('/connector-connections', isProd ? requireAuth : attachUser, validateBody(z.object({
  connectorId: z.string().min(1),
  config: z.record(z.any()).optional(),
  accountId: z.string().optional(),
})), async (req: AuthRequest, res) => {
  const { connectorId, config, accountId: bodyAccountId } = (req as any).validatedBody;
  const accountId = resolveAccountId(req, bodyAccountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  if (!registry.get(connectorId)) return res.status(404).json({ error: 'connecteur inconnu' });
  const { upsertConnection } = await import('../db/repos/connections.repo.js');
  const id = upsertConnection(accountId, connectorId, config);
  return res.json({ ok: true, id });
});

connectionsRouter.patch('/connector-connections/:id', isProd ? requireAuth : attachUser, validateBody(z.object({
  active: z.boolean().optional(),
  config: z.record(z.any()).optional(),
  accountId: z.string().optional(),
})), (req: AuthRequest, res) => {
  const { active, config, accountId: bodyAccountId } = (req as any).validatedBody;
  const accountId = resolveAccountId(req, bodyAccountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = updateConnection(id, accountId, { active, config });
  if (!ok) return res.status(404).json({ error: 'connexion introuvable' });
  return res.json({ ok: true });
});

// Secrets/tokens (mot de passe IMAP, tokens OAuth...) : chiffrés avant stockage.
connectionsRouter.put('/connector-connections/:id/tokens', isProd ? requireAuth : attachUser, validateBody(z.object({
  tokens: z.record(z.any()),
  accountId: z.string().optional(),
})), (req: AuthRequest, res) => {
  const { tokens, accountId: bodyAccountId } = (req as any).validatedBody;
  const accountId = resolveAccountId(req, bodyAccountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const encrypted = encryptToken(JSON.stringify(tokens));
  const ok = setConnectionTokens(id, accountId, encrypted);
  if (!ok) return res.status(404).json({ error: 'connexion introuvable' });
  return res.json({ ok: true });
});

// Régénère URL + secret d'un endpoint (l'ancienne URL et l'ancien secret sont invalidés).
connectionsRouter.post('/webhook/endpoints/:id/rotate', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const accountId = resolveAccountId(req, req.body?.accountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const rawToken = generatePathToken();
  const tokenHash = hashPathToken(rawToken);
  if (!rotateEndpointToken(id, accountId, tokenHash)) {
    return res.status(404).json({ error: 'endpoint introuvable ou inactif' });
  }

  const secret = generateWebhookSecret();
  rotateEndpointSecret(id, accountId, encryptWebhookSecret(secret));

  const url = `${req.protocol}://${req.get('host')}/webhooks/w/${rawToken}`;
  return res.json({
    ok: true,
    url,
    pathToken: rawToken,
    secret,
    warning: 'Nouvelle URL et nouveau secret générés. Les anciens sont invalides.',
  });
});

// Teste la connexion/config sans polling ni écriture d'événements (ex. IMAP).
connectionsRouter.post('/connector-connections/:id/test', isProd ? requireAuth : attachUser, async (req: AuthRequest, res) => {
  const accountId = resolveAccountId(req, req.body?.accountId);
  if (!accountId) return res.status(400).json({ error: 'accountId requis' });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const row = getConnection(id, accountId);
  if (!row) return res.status(404).json({ error: 'connexion introuvable' });

  const connector = registry.get(row.connector_id);
  if (!connector?.test) return res.status(400).json({ error: 'test non supporté pour ce connecteur' });

  let config: Record<string, unknown> = {};
  if (row.config_json) {
    try { config = JSON.parse(row.config_json); } catch { config = {}; }
  }

  let tokens: Record<string, unknown> | null = null;
  if (row.encrypted_tokens_json) {
    try {
      tokens = JSON.parse(decryptToken(row.encrypted_tokens_json)) as Record<string, unknown>;
    } catch {
      return res.status(500).json({ error: 'tokens illisibles (clé de chiffrement ?)' });
    }
  }

  try {
    const result = await connector.test({ accountId, config, tokens });
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
