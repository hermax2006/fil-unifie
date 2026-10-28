import type { Request, Response } from 'express';
import type { UnifiedEvent } from '@fil/shared';

/** Flux temps réel (SSE) : chaque navigateur connecté reçoit les nouveaux événements. */
const clients = new Set<Response>();

export function sseHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connecté\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function broadcast(e: UnifiedEvent): void {
  const data = `data: ${JSON.stringify(e)}\n\n`;
  for (const c of clients) c.write(data);
}
