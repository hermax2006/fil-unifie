import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSlackAuthUrl, exchangeSlackCode, slackOAuthConfigured, slackRedirectUri } from '../oauth/slack.js';
import { SlackConnector } from '../connectors/slack.connector.js';

const connector = new SlackConnector();

beforeEach(() => {
  vi.stubEnv('SLACK_CLIENT_ID', 'slack-client');
  vi.stubEnv('SLACK_CLIENT_SECRET', 'slack-secret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('OAuth Slack', () => {
  it('construit l’URL d’autorisation avec les scopes bot', () => {
    const url = new URL(buildSlackAuthUrl('state-9'));
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('slack-client');
    expect(url.searchParams.get('redirect_uri')).toBe(slackRedirectUri());
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope.split(',')).toEqual(expect.arrayContaining(['chat:write', 'channels:history', 'im:history']));
    expect(url.searchParams.get('state')).toBe('state-9');
    expect(slackOAuthConfigured()).toBe(true);
  });

  it('échange le code et renvoie team + bot token', async () => {
    const calls: URLSearchParams[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({
        ok: true,
        access_token: 'xoxb-1',
        bot_user_id: 'UBOT',
        team: { id: 'T1', name: 'Mon équipe' },
        scope: 'chat:write,channels:history',
      }));
    }));
    const result = await exchangeSlackCode('code-1');
    expect(result.access_token).toBe('xoxb-1');
    expect(result.team?.name).toBe('Mon équipe');
    expect(calls[0].get('code')).toBe('code-1');
    expect(calls[0].get('redirect_uri')).toBe(slackRedirectUri());
  });

  it('remonte l’erreur Slack (ok:false)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'invalid_code' }))));
    await expect(exchangeSlackCode('mauvais')).rejects.toThrow('invalid_code');
  });
});

describe('SlackConnector', () => {
  it('normalise un message avec le canal dans externalId', () => {
    const events = connector.normalize({
      headers: {},
      rawBody: Buffer.from(''),
      body: {
        type: 'event_callback',
        event: { type: 'message', channel: 'C123', user: 'U42', text: 'Bonjour', ts: '1700000000.000100' },
      },
    } as any, 'acc-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      connector: 'slack',
      externalId: 'slack:C123:1700000000.000100',
      kind: 'message',
      body: 'Bonjour',
    });
    expect(events[0].author?.id).toBe('U42');
  });

  it('répond dans le fil du canal (chat.postMessage)', async () => {
    let body: any;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://slack.com/api/chat.postMessage');
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, ts: '1700000001.000200' }));
    }));
    const res = await connector.reply({
      accountId: 'acc-1',
      config: {},
      tokens: { accessToken: 'xoxb-1' },
      to: ['U42'],
      inReplyTo: 'slack:C123:1700000000.000100',
      body: 'Ma réponse',
    });
    expect(res.messageId).toBe('1700000001.000200');
    expect(body).toMatchObject({ channel: 'C123', text: 'Ma réponse', thread_ts: '1700000000.000100' });
  });

  it('échoue clairement sans jeton bot', async () => {
    await expect(connector.reply({
      accountId: 'acc-1', config: {}, tokens: null, to: ['U42'], body: 'x',
    })).rejects.toThrow('jeton du bot absent');
  });
});
