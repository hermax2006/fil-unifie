import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { attachUser, type AuthRequest } from '../auth/middleware.js';
import { findOrCreateAccountForUser } from '../db/repos/accounts.repo.js';
import {
  listConnections,
  createConnection,
  updateConnection,
  setConnectionTokens,
  type ConnectorConnectionRow,
} from '../db/repos/connections.repo.js';
import { encryptToken } from '../crypto/tokens.js';
import { config } from '../config/index.js';
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleOAuthConfigured,
  emailFromIdToken,
  GOOGLE_CALENDAR_SCOPE,
} from '../oauth/google.js';
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  microsoftOAuthConfigured,
  emailFromMicrosoftIdToken,
} from '../oauth/microsoft.js';
import { buildSlackAuthUrl, exchangeSlackCode, slackOAuthConfigured } from '../oauth/slack.js';

export const oauthRouter = Router();

const STATE_COOKIE = 'g_oauth_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** Retour vers l'app (Vite en dev, même origine en prod) avec un statut lisible. */
function backToApp(res: Response, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return res.redirect(`${config.clientUrl}/?${query}`);
}

function stateMatches(a?: string, b?: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function beginFlow(req: AuthRequest, res: Response, provider: string, url: string) {
  if (!req.userId) return backToApp(res, { oauth: provider, status: 'login' });
  const state = randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: STATE_MAX_AGE_MS,
    path: '/auth',
  });
  return res.redirect(url.replace('{state}', state));
}

/** Vérifie le state anti-CSRF (cookie httpOnly + query). */
function takeState(req: AuthRequest, res: Response, provider: string, state?: string): string | null {
  const cookieState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/auth' });
  if (!req.userId) {
    backToApp(res, { oauth: provider, status: 'login' });
    return null;
  }
  if (!stateMatches(state, cookieState)) {
    backToApp(res, { oauth: provider, status: 'error', reason: 'state' });
    return null;
  }
  return cookieState ?? null;
}

/** Connexion réutilisée si elle appartient déjà à ce compte/compte distant. */
function findConnection(
  accountId: string,
  connectorId: string,
  match: (cfg: Record<string, unknown>) => boolean,
): ConnectorConnectionRow | undefined {
  return listConnections(accountId).find((c) => {
    if (c.connector_id !== connectorId || !c.config_json) return false;
    try {
      return match(JSON.parse(c.config_json) as Record<string, unknown>);
    } catch {
      return false;
    }
  });
}

function saveTokens(connectionId: string, accountId: string, tokens: Record<string, unknown>) {
  setConnectionTokens(connectionId, accountId, encryptToken(JSON.stringify(tokens)));
}

function storeOAuthConnection(
  accountId: string,
  connectorId: string,
  cfg: Record<string, unknown>,
  match: (cfg: Record<string, unknown>) => boolean,
  tokens: Record<string, unknown>,
): string {
  const existing = findConnection(accountId, connectorId, match);
  const id = existing ? existing.id : createConnection(accountId, connectorId, cfg);
  if (existing) updateConnection(id, accountId, { active: true, config: cfg });
  saveTokens(id, accountId, tokens);
  return id;
}

// --- Disponibilité (l'UI n'affiche que les boutons configurés) -------------

oauthRouter.get('/google/available', (_req, res) => {
  res.json({ available: googleOAuthConfigured(), calendar: googleOAuthConfigured() });
});

oauthRouter.get('/microsoft/available', (_req, res) => {
  res.json({ available: microsoftOAuthConfigured() });
});

oauthRouter.get('/slack/available', (_req, res) => {
  res.json({ available: slackOAuthConfigured() });
});

// --- Gmail ------------------------------------------------------------------

oauthRouter.get('/google/start', attachUser, (req: AuthRequest, res) => {
  if (!googleOAuthConfigured()) return backToApp(res, { oauth: 'google', status: 'unconfigured' });
  const url = buildGoogleAuthUrl('{state}', req.user?.email);
  return beginFlow(req, res, 'google', url);
});

oauthRouter.get('/google/callback', attachUser, async (req: AuthRequest, res) => {
  const fail = (reason: string) => backToApp(res, { oauth: 'google', status: 'error', reason });
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (!takeState(req, res, 'google', state)) return;
  if (error) return fail(error);
  if (!code) return fail('missing_code');

  try {
    const tokens = await exchangeGoogleCode(code);
    const email = emailFromIdToken(tokens.id_token);
    if (!email) return fail('email_absent');
    if (!tokens.refresh_token) return fail('refresh_token_absent');
    // Google ne délivre que les scopes déclarés dans « Data Access » : sans
    // https://mail.google.com/, IMAP/SMTP en XOAUTH2 échouent (invalid credentials).
    const granted = String(tokens.scope ?? '').split(/\s+/);
    if (!granted.includes('https://mail.google.com/')) return fail('scope_mail_absent');

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
    storeOAuthConnection(
      account.id,
      'imap',
      cfg,
      (c) => c.user === email,
      {
        authType: 'oauth2',
        provider: 'google',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
        scope: tokens.scope,
      },
    );
    return backToApp(res, { oauth: 'google', status: 'ok' });
  } catch (err) {
    console.error('OAuth Google (échange du code)', err);
    return fail('exchange');
  }
});

// --- Google Calendar --------------------------------------------------------

oauthRouter.get('/google/calendar/start', attachUser, (req: AuthRequest, res) => {
  if (!googleOAuthConfigured()) return backToApp(res, { oauth: 'calendar', status: 'unconfigured' });
  const url = buildGoogleAuthUrl('{state}', req.user?.email, GOOGLE_CALENDAR_SCOPE);
  return beginFlow(req, res, 'calendar', url);
});

oauthRouter.get('/google/calendar/callback', attachUser, async (req: AuthRequest, res) => {
  const fail = (reason: string) => backToApp(res, { oauth: 'calendar', status: 'error', reason });
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (!takeState(req, res, 'calendar', state)) return;
  if (error) return fail(error);
  if (!code) return fail('missing_code');

  try {
    const tokens = await exchangeGoogleCode(code);
    const email = emailFromIdToken(tokens.id_token);
    if (!email) return fail('email_absent');
    if (!tokens.refresh_token) return fail('refresh_token_absent');
    const granted = String(tokens.scope ?? '').split(/\s+/);
    if (!granted.includes('https://www.googleapis.com/auth/calendar.readonly')) return fail('scope_calendar_absent');

    const account = findOrCreateAccountForUser(req.userId!);
    storeOAuthConnection(
      account.id,
      'gcal',
      { calendarId: 'primary', user: email },
      (c) => c.user === email,
      {
        authType: 'oauth2',
        provider: 'google',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
        scope: tokens.scope,
      },
    );
    return backToApp(res, { oauth: 'calendar', status: 'ok' });
  } catch (err) {
    console.error('OAuth Google Agenda (échange du code)', err);
    return fail('exchange');
  }
});

// --- Outlook / Microsoft 365 ------------------------------------------------

oauthRouter.get('/microsoft/start', attachUser, (req: AuthRequest, res) => {
  if (!microsoftOAuthConfigured()) return backToApp(res, { oauth: 'microsoft', status: 'unconfigured' });
  const url = buildMicrosoftAuthUrl('{state}', req.user?.email);
  return beginFlow(req, res, 'microsoft', url);
});

oauthRouter.get('/microsoft/callback', attachUser, async (req: AuthRequest, res) => {
  const fail = (reason: string) => backToApp(res, { oauth: 'microsoft', status: 'error', reason });
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
  if (!takeState(req, res, 'microsoft', state)) return;
  if (error) return fail(error_description ? 'access_denied' : error);
  if (!code) return fail('missing_code');

  try {
    const tokens = await exchangeMicrosoftCode(code);
    const email = emailFromMicrosoftIdToken(tokens.id_token);
    if (!email) return fail('email_absent');
    if (!tokens.refresh_token) return fail('refresh_token_absent');
    const granted = String(tokens.scope ?? '').toLowerCase();
    if (!granted.includes('imap.accessasuser.all')) return fail('scope_mail_absent');

    const account = findOrCreateAccountForUser(req.userId!);
    const cfg = {
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
      user: email,
      mailboxes: ['INBOX'],
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpSecure: false,
    };
    storeOAuthConnection(
      account.id,
      'imap',
      cfg,
      (c) => c.user === email,
      {
        authType: 'oauth2',
        provider: 'microsoft',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
        scope: tokens.scope,
      },
    );
    return backToApp(res, { oauth: 'microsoft', status: 'ok' });
  } catch (err) {
    console.error('OAuth Microsoft (échange du code)', err);
    return fail('exchange');
  }
});

// --- Slack ------------------------------------------------------------------

oauthRouter.get('/slack/start', attachUser, (req: AuthRequest, res) => {
  if (!slackOAuthConfigured()) return backToApp(res, { oauth: 'slack', status: 'unconfigured' });
  return beginFlow(req, res, 'slack', buildSlackAuthUrl('{state}'));
});

oauthRouter.get('/slack/callback', attachUser, async (req: AuthRequest, res) => {
  const fail = (reason: string) => backToApp(res, { oauth: 'slack', status: 'error', reason });
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (!takeState(req, res, 'slack', state)) return;
  if (error) return fail(error);
  if (!code) return fail('missing_code');

  try {
    const result = await exchangeSlackCode(code);
    const teamId = result.team?.id ?? 'unknown';
    const account = findOrCreateAccountForUser(req.userId!);
    storeOAuthConnection(
      account.id,
      'slack',
      { teamId, teamName: result.team?.name ?? teamId },
      (c) => c.teamId === teamId,
      {
        authType: 'oauth2',
        provider: 'slack',
        accessToken: result.access_token,
        botUserId: result.bot_user_id,
        teamId,
        scope: result.scope,
      },
    );
    return backToApp(res, { oauth: 'slack', status: 'ok' });
  } catch (err) {
    console.error('OAuth Slack (échange du code)', err);
    return fail('exchange');
  }
});
