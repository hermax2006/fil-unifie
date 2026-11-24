import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  microsoftOAuthConfigured,
  microsoftRedirectUri,
  refreshMicrosoftAccessToken,
  emailFromMicrosoftIdToken,
} from '../oauth/microsoft.js';

function stubTokenEndpoint(payload: Record<string, unknown>, ok = true, status = 200) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
    return new Response(JSON.stringify(payload), { status });
  }));
  return calls;
}

function fakeIdToken(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.signature`;
}

beforeEach(() => {
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'ms-client');
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'ms-secret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('OAuth Microsoft', () => {
  it('est « configuré » seulement avec client id + secret', () => {
    expect(microsoftOAuthConfigured()).toBe(true);
    vi.stubEnv('MICROSOFT_CLIENT_ID', '');
    expect(microsoftOAuthConfigured()).toBe(false);
  });

  it('construit l’URL d’autorisation (IMAP + SMTP + offline_access)', () => {
    const url = new URL(buildMicrosoftAuthUrl('state-1', 'moi@outlook.com'));
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('ms-client');
    expect(url.searchParams.get('redirect_uri')).toBe(microsoftRedirectUri());
    expect(url.searchParams.get('response_mode')).toBe('query');
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('offline_access');
    expect(scope).toContain('https://outlook.office.com/IMAP.AccessAsUser.All');
    expect(scope).toContain('https://outlook.office.com/SMTP.Send');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('login_hint')).toBe('moi@outlook.com');
  });

  it('échange le code puis rafraîchit avec les scopes', async () => {
    const calls = stubTokenEndpoint({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' });
    await exchangeMicrosoftCode('code-1');
    expect(calls[0].body.get('grant_type')).toBe('authorization_code');
    expect(calls[0].body.get('redirect_uri')).toBe(microsoftRedirectUri());
    await refreshMicrosoftAccessToken('rt');
    expect(calls[1].body.get('grant_type')).toBe('refresh_token');
    expect(calls[1].body.get('scope')).toContain('IMAP.AccessAsUser.All');
  });

  it('lit l’email dans preferred_username', () => {
    expect(emailFromMicrosoftIdToken(fakeIdToken({ preferred_username: 'moi@outlook.com' }))).toBe('moi@outlook.com');
    expect(emailFromMicrosoftIdToken(fakeIdToken({ email: 'autre@outlook.com' }))).toBe('autre@outlook.com');
    expect(emailFromMicrosoftIdToken(undefined)).toBeUndefined();
  });
});
