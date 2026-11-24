import { config } from '../config/index.js';
import type { GoogleTokens } from './google.js';

/**
 * Microsoft identity platform v2.0 — Outlook / Microsoft 365.
 * IMAP et SMTP utilisent XOAUTH2 : les scopes `IMAP.AccessAsUser.All` et
 * `SMTP.Send` sont requis, plus `offline_access` pour obtenir un refresh token.
 */
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export const MICROSOFT_SCOPE = [
  'offline_access',
  'openid',
  'email',
  'profile',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

export function microsoftOAuthConfigured(): boolean {
  return !!process.env.MICROSOFT_CLIENT_ID && !!process.env.MICROSOFT_CLIENT_SECRET;
}

export function microsoftRedirectUri(): string {
  return `${config.publicBaseUrl}/auth/microsoft/callback`;
}

export function buildMicrosoftAuthUrl(state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: microsoftRedirectUri(),
    response_mode: 'query',
    scope: MICROSOFT_SCOPE,
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof data.error_description === 'string' ? data.error_description : String(data.error ?? res.status);
    throw new Error(`Microsoft OAuth: ${detail}`);
  }
  if (typeof data.access_token !== 'string') throw new Error('Microsoft OAuth: réponse sans access_token');
  return data as unknown as GoogleTokens;
}

export function exchangeMicrosoftCode(code: string): Promise<GoogleTokens> {
  return postToken({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
    client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: microsoftRedirectUri(),
    scope: MICROSOFT_SCOPE,
  });
}

export function refreshMicrosoftAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return postToken({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
    client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    // Microsoft exige de redemander les scopes au refresh.
    scope: MICROSOFT_SCOPE,
  });
}

/** Email du compte Microsoft (l'id_token expose `email` ou `preferred_username`). */
export function emailFromMicrosoftIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
      preferred_username?: unknown;
    };
    const value = json.email ?? json.preferred_username;
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
