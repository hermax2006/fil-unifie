import type { Request, Response, NextFunction } from 'express';
import { getSession } from '../db/repos/sessions.repo.js';
import { findUserById } from '../db/repos/users.repo.js';

export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'non authentifié' });
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'session invalide ou expirée' });
  const user = findUserById(session.user_id);
  if (!user) return res.status(401).json({ error: 'utilisateur introuvable' });
  req.userId = user.id;
  req.user = { id: user.id, email: user.email };
  next();
}

export function attachUser(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (!token) return next();
  const session = getSession(token);
  if (!session) return next();
  const user = findUserById(session.user_id);
  if (user) {
    req.userId = user.id;
    req.user = { id: user.id, email: user.email };
  }
  next();
}
