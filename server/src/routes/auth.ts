import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createUser, findUserByEmail } from '../db/repos/users.repo.js';
import { createSession, deleteSession } from '../db/repos/sessions.repo.js';
import { requireAuth, type AuthRequest } from '../auth/middleware.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email et mot de passe requis' });
    if (String(password).length < 6) return res.status(400).json({ error: 'mot de passe trop court (6 min)' });
    if (findUserByEmail(email)) return res.status(409).json({ error: 'cet email est déjà utilisé' });
    const hash = await bcrypt.hash(String(password), 10);
    const user = createUser(email, hash);
    const session = createSession(user.id);
    res.cookie('session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email et mot de passe requis' });
    const user = findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'identifiants invalides' });
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'identifiants invalides' });
    const session = createSession(user.id);
    res.cookie('session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true, user: { id: user.id, email: user.email } });
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
  return res.json({ user: req.user });
});
