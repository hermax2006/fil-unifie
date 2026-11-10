import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createUser, findUserByEmail } from '../db/repos/users.repo.js';
import { createSession, deleteSession } from '../db/repos/sessions.repo.js';
import { requireAuth, type AuthRequest } from '../auth/middleware.js';
import { findOrCreateAccountForUser } from '../db/repos/accounts.repo.js';
import { validateBody } from '../utils/validate.js';
import { authLimiter } from '../middleware/rate-limit.js';

export const authRouter = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

authRouter.post('/register', authLimiter, validateBody(authSchema), async (req, res) => {
  try {
    const { email, password } = (req as any).validatedBody as z.infer<typeof authSchema>;
    if (findUserByEmail(email)) return res.status(409).json({ error: 'cet email est déjà utilisé' });
    const hash = await bcrypt.hash(password, 10);
    const user = createUser(email, hash);
    const account = findOrCreateAccountForUser(user.id);
    const session = createSession(user.id);
    res.cookie('session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true, user: { id: user.id, email: user.email, accountId: account.id } });
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur' });
  }
});

authRouter.post('/login', authLimiter, validateBody(authSchema), async (req, res) => {
  try {
    const { email, password } = (req as any).validatedBody as z.infer<typeof authSchema>;
    const user = findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'identifiants invalides' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'identifiants invalides' });
    const account = findOrCreateAccountForUser(user.id);
    const session = createSession(user.id);
    res.cookie('session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true, user: { id: user.id, email: user.email, accountId: account.id } });
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur' });
  }
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) deleteSession(token);
  res.clearCookie('session');
  return res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthRequest, res) => {
  const account = req.userId ? findOrCreateAccountForUser(req.userId) : null;
  return res.json({ user: { ...req.user, accountId: account?.id } });
});
