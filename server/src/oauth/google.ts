import { config } from '../config/index.js';

/**
 * OAuth 2.0 Google pour Gmail.
 * Scope `https://mail.google.com/` : nécessaire pour IMAP/SMTP en XOAUTH2
 * (lecture + envoi). Le jeton d'accès dure ~1 h, d'où le refresh token.
 */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPE = 'openid email https://mail.google.com/';

export interface GoogleTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

/** Configuré dès que les identifiants Google Cloud sont présents (l'UI s'adapte). */
export function googleOAuthConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export function googleRedirectUri(): string {
  return `${config.publicBaseUrl}/auth/google/callback`;
}

export function buildGoogleAuthUrl(state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    // Sans consentement explicite, Google ne renvoie le refresh token qu'une fois.
    prompt: 'consent',
    include_granted_scopes: 'true',
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
    throw new Error(`Google OAuth: ${detail}`);
  }
  if (typeof data.access_token !== 'string') throw new Error('Google OAuth: réponse sans access_token');
  return data as unknown as GoogleTokens;
}

export function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  return postToken({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: googleRedirectUri(),
  });
}

export function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return postToken({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

/** Email du compte : lu dans l'id_token reçu directement de Google (canal TLS). */
export function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof json.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}
