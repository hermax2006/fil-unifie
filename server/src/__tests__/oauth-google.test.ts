import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleOAuthConfigured,
  googleRedirectUri,
  refreshGoogleAccessToken,
  emailFromIdToken,
} from '../oauth/google.js';
import { decodeConnectionTokens, isOAuthTokens } from '../oauth/tokens.js';
import { encryptToken } from '../crypto/tokens.js';

function stubTokenEndpoint(payload: Record<string, unknown>, ok = true, status = 200) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
    return new Response(JSON.stringify(payload), { status });
  }));
  return calls;
}

function fakeIdToken(email: string): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64({ email, email_verified: true })}.signature`;
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret-456');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('OAuth Google', () => {
  it('est « configuré » seulement avec client id + secret', () => {
    expect(googleOAuthConfigured()).toBe(true);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect(googleOAuthConfigured()).toBe(false);
  });

  it('construit l’URL d’autorisation (offline, consentement, scope mail)', () => {
    const url = new URL(buildGoogleAuthUrl('state-abc', 'moi@gmail.com'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-123.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(googleRedirectUri());
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe('openid email https://mail.google.com/');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('login_hint')).toBe('moi@gmail.com');
  });

  it('échange le code contre des jetons', async () => {
    const calls = stubTokenEndpoint({
      access_token: 'at-1',
      expires_in: 3599,
      refresh_token: 'rt-1',
      scope: 'https://mail.google.com/',
      id_token: fakeIdToken('moi@gmail.com'),
    });
    const tokens = await exchangeGoogleCode('code-xyz');
    expect(tokens.access_token).toBe('at-1');
    expect(tokens.refresh_token).toBe('rt-1');
    expect(calls[0].url).toContain('oauth2.googleapis.com/token');
    expect(calls[0].body.get('grant_type')).toBe('authorization_code');
    expect(calls[0].body.get('code')).toBe('code-xyz');
    expect(calls[0].body.get('redirect_uri')).toBe(googleRedirectUri());
    expect(emailFromIdToken(tokens.id_token)).toBe('moi@gmail.com');
  });

  it('rafraîchit un access token expiré', async () => {
    const calls = stubTokenEndpoint({ access_token: 'at-2', expires_in: 3600 });
    const tokens = await refreshGoogleAccessToken('rt-1');
    expect(tokens.access_token).toBe('at-2');
    expect(calls[0].body.get('grant_type')).toBe('refresh_token');
    expect(calls[0].body.get('refresh_token')).toBe('rt-1');
  });

  it('remonte un message lisible quand Google refuse', async () => {
    stubTokenEndpoint({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, false, 400);
    await expect(refreshGoogleAccessToken('rt-mort')).rejects.toThrow('Token has been expired or revoked.');
  });

  it('décode une connexion OAuth chiffrée et distingue le mode mot de passe', () => {
    const encrypted = encryptToken(JSON.stringify({
      authType: 'oauth2',
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: Date.now() + 3600_000,
    }));
    const tokens = decodeConnectionTokens(encrypted);
    expect(isOAuthTokens(tokens)).toBe(true);
    expect(tokens?.refreshToken).toBe('rt-1');

    const legacy = decodeConnectionTokens(encryptToken(JSON.stringify({ pass: 'abcd efgh' })));
    expect(isOAuthTokens(legacy)).toBe(false);
  });
});
