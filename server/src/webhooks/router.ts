import { Router } from 'express';
import { registry } from '../connectors/registry.js';
import { secretFor } from '../config/index.js';
import { enqueueEvent } from '../queues/index.js';
import { resolveEndpoint } from './endpoint-resolver.js';
import { decryptWebhookSecret } from './secret-manager.js';

export const webhooksRouter = Router();

/** Nouveau mode sécurisé : par point d'entrée unique (path_token) */
webhooksRouter.post('/w/:pathToken', (req, res) => {
  const endpoint = resolveEndpoint(req.params.pathToken);
  if (!endpoint || !endpoint.active) return void res.status(404).json({ error: 'point d\'entrée inconnu ou désactivé' });

  const connector = registry.get(endpoint.connector_id);
  if (!connector) return void res.status(404).json({ error: 'connecteur inconnu' });

  const wr = {
    headers: req.headers,
    rawBody: (req as any).rawBody as Buffer,
    body: req.body,
  };

  let secret: string | undefined = undefined;
  if (endpoint.secret_encrypted) {
    try {
      secret = decryptWebhookSecret(endpoint.secret_encrypted);
    } catch {
      return void res.status(500).json({ error: 'erreur de déchiffrement du secret' });
    }
  }

  if (!wr.rawBody || !connector.verifyWebhook(wr, secret)) {
    return void res.status(401).json({ error: 'signature invalide' });
  }

  const handshake = connector.handshake(wr);
  if (handshake !== undefined) return void res.json(handshake);

  const events = connector.normalize(wr, endpoint.account_id);
  events.forEach(enqueueEvent);
  res.status(200).json({ accepted: events.length });
});

/** Ancien mode (rétrocompatibilité) - à garder temporairement en dev uniquement */
webhooksRouter.post('/:connector/:accountId', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return void res.status(410).json({ error: 'cet endpoint est obsolète. Utiliser /webhooks/w/:path_token' });
  }

  const connector = registry.get(req.params.connector);
  if (!connector) return void res.status(404).json({ error: 'connecteur inconnu' });

  const wr = {
    headers: req.headers,
    rawBody: (req as any).rawBody as Buffer,
    body: req.body,
  };

  if (!wr.rawBody || !connector.verifyWebhook(wr, secretFor(connector.info.id))) {
    return void res.status(401).json({ error: 'signature invalide' });
  }

  const handshake = connector.handshake(wr);
  if (handshake !== undefined) return void res.json(handshake);

  const events = connector.normalize(wr, req.params.accountId);
  events.forEach(enqueueEvent);
  res.status(200).json({ accepted: events.length });
});
