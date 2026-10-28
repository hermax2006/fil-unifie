import { Router } from 'express';
import { registry } from '../connectors/registry.js';
import { secretFor } from '../config/index.js';
import { enqueueEvent } from '../queues/index.js';

export const webhooksRouter = Router();

/** Reçoit, vérifie la signature, met en file, répond vite. */
webhooksRouter.post('/:connector/:accountId', (req, res) => {
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
