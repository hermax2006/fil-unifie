import { config } from '../config/index.js';

/**
 * Slack OAuth v2 (bot token).
 * - La lecture passe par les Event Subscriptions (webhook `/webhooks/w/...`).
 * - Le bot token sert à répondre (`chat.postMessage`) depuis le fil.
 */
const AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

export const SLACK_SCOPES = [
  'channels:history',
  'groups:history',
  'im:history',
  'mpim:history',
  'channels:read',
  'groups:read',
  'im:read',
  'users:read',
  'chat:write',
  'team:read',
].join(',');

export interface SlackOAuthResult {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  scope?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string };
}

export function slackOAuthConfigured(): boolean {
  return !!process.env.SLACK_CLIENT_ID && !!process.env.SLACK_CLIENT_SECRET;
}

export function slackRedirectUri(): string {
  return `${config.publicBaseUrl}/auth/slack/callback`;
}

export function buildSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID ?? '',
    scope: SLACK_SCOPES,
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeSlackCode(code: string): Promise<SlackOAuthResult> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
      code,
      redirect_uri: slackRedirectUri(),
    }).toString(),
  });
  const data = (await res.json().catch(() => ({ ok: false, error: 'invalid_response' }))) as SlackOAuthResult;
  if (!data.ok || !data.access_token) {
    throw new Error(`Slack OAuth: ${data.error ?? `HTTP ${res.status}`}`);
  }
  return data;
}
