import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { requireAuth, type AuthRequest } from '../auth/middleware.js';
import { findOrCreateAccountForUser } from '../db/repos/accounts.repo.js';
import {
  listConnections,
  createConnection,
  updateConnection,
  setConnectionTokens,
} from '../db/repos/connections.repo.js';
import { encryptToken } from '../crypto/tokens.js';
import { config } from '../config/index.js';
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleOAuthConfigured,
  emailFromIdToken,
} from '../oauth/google.js';

export const oauthRouter = Router();

const STATE_COOKIE = 'g_oauth_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** Retour vers l'app (Vite en dev, même origine en prod) avec un statut lisible. */
function backToApp(res: import('express').Response, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return res.redirect(`${config.clientUrl}/?${query}`);
}

function stateMatches(a?: string, b?: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** L'UI affiche le bouton « Se connecter avec Google » seulement si configuré. */
oauthRouter.get('/google/available', (_req, res) => {
  return res.json({ available: googleOAuthConfigured() });
});

oauthRouter.get('/google/start', requireAuth, (req: AuthRequest, res) => {
  if (!googleOAuthConfigured()) {
    return backToApp(res, { oauth: 'google', status: 'unconfigured' });
  }
  const state = randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: STATE_MAX_AGE_MS,
    path: '/auth/google',
  });
  return res.redirect(buildGoogleAuthUrl(state, req.user?.email));
});

oauthRouter.get('/google/callback', requireAuth, async (req: AuthRequest, res) => {
  const fail = (reason: string) => backToApp(res, { oauth: 'google', status: 'error', reason });
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const cookieState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/auth/google' });

  if (error) return fail(error);
  if (!stateMatches(state, cookieState)) return fail('state');
  if (!code) return fail('missing_code');

  try {
    const tokens = await exchangeGoogleCode(code);
    const email = emailFromIdToken(tokens.id_token);
    if (!email) return fail('email_absent');
    if (!tokens.refresh_token) return fail('refresh_token_absent');

    const account = findOrCreateAccountForUser(req.userId!);
    const cfg = {
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      user: email,
      mailboxes: ['INBOX'],
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
    };
    // Réutilise la connexion déjà existante pour cette boîte (reconnexion).
    const existing = listConnections(account.id).find((c) => {
      if (c.connector_id !== 'imap' || !c.config_json) return false;
      try {
        return (JSON.parse(c.config_json) as { user?: string }).user === email;
      } catch {
        return false;
      }
    });
    const id = existing ? existing.id : createConnection(account.id, 'imap', cfg);
    if (existing) updateConnection(id, account.id, { active: true, config: cfg });

    setConnectionTokens(id, account.id, encryptToken(JSON.stringify({
      authType: 'oauth2',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      scope: tokens.scope,
    })));

    return backToApp(res, { oauth: 'google', status: 'ok' });
  } catch (err) {
    console.error('OAuth Google (échange du code)', err);
    return fail('exchange');
  }
});
