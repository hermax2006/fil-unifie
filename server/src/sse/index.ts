import type { Request, Response } from 'express';
import type { UnifiedEvent } from '@fil/shared';
import { attachUser, type AuthRequest } from '../auth/middleware.js';
import { findAccountById } from '../db/repos/accounts.repo.js';

/**
 * Flux temps réel (SSE).
 * - En dev sans auth, broadcast global (comme avant).
 * - Dès qu'on connaît userId (session), on n'envoie qu'aux clients du même user.
 */
type Client = { res: Response; userId?: string };
const clients = new Set<Client>();

export function sseHandler(req: AuthRequest, res: Response): void {
  attachUser(req, res, () => {
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
    // Si pas de userId connu (dev/legacy), on diffuse. Sinon on filtre.
    if (!c.userId || !ownerUserId || c.userId === ownerUserId) {
      c.res.write(data);
    }
  }
}
