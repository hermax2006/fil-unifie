import type { Request, Response } from 'express';
import type { UnifiedEvent } from '@fil/shared';
import { attachUser, type AuthRequest } from '../auth/middleware.js';
import { findAccountById } from '../db/repos/accounts.repo.js';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Flux temps réel (SSE).
 * - En dev sans auth, broadcast global (comme avant).
 * - Dès qu'on connaît userId (session), on n'envoie qu'aux clients du même user.
 */
type Client = { res: Response; userId?: string };
const clients = new Set<Client>();

export function sseHandler(req: AuthRequest, res: Response): void {
  attachUser(req, res, () => {
    // En prod, pas de session = pas de flux : on refuse avant d'ouvrir quoi que ce soit.
    if (isProd && !req.userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ error: 'non authentifié' }));
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connecté\n\n');
    const client: Client = { res, userId: req.userId };
    clients.add(client);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(client);
    });
  });
}

export function broadcast(e: UnifiedEvent): void {
  const data = `data: ${JSON.stringify(e)}\n\n`;
  let ownerUserId: string | undefined;
  if (e.accountId) {
    const acc = findAccountById(e.accountId);
    ownerUserId = acc?.user_id;
  }
  for (const c of clients) {
    // En prod, un client sans session n'a pas pu se connecter ; par sécurité on saute aussi ici.
    if (isProd && !c.userId) continue;
    // En dev sans userId connu (legacy), on diffuse. Sinon on filtre par utilisateur.
    if (!c.userId || !ownerUserId || c.userId === ownerUserId) {
      c.res.write(data);
    }
  }
}
