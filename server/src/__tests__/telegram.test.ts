import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramConnector } from '../connectors/telegram.connector.js';

const connector = new TelegramConnector();

function update(over: any = {}) {
  return {
    update_id: 1001,
    message: {
      message_id: 42,
      date: 1700000000,
      chat: { id: 987654321, type: 'private' },
      from: { id: 987654321, first_name: 'Ama', last_name: 'Koffi' },
      text: 'Bonjour depuis Telegram',
      ...over,
    },
  };
}

function stubTelegram(result: unknown, ok = true, status = 200) {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(ok ? { ok: true, result } : { ok: false, description: 'Bad Request' }), { status });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('TelegramConnector', () => {
  it('normalise un message en événement (auteur, chat, date)', () => {
    const events = connector.normalize({ headers: {}, rawBody: Buffer.from(''), body: update() } as any, 'acc-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      connector: 'telegram',
      accountId: 'acc-1',
      externalId: 'tg:987654321:42',
      kind: 'message',
      author: { id: '987654321', name: 'Ama Koffi' },
      body: 'Bonjour depuis Telegram',
      occurredAt: new Date(1700000000 * 1000).toISOString(),
    });
  });

  it('ignore les messages de bots et les messages sans texte', () => {
    expect(connector.normalize({ headers: {}, rawBody: Buffer.from(''), body: update({ from: { id: 1, is_bot: true }, text: 'x' }) } as any, 'a')).toHaveLength(0);
    expect(connector.normalize({ headers: {}, rawBody: Buffer.from(''), body: update({ text: undefined, caption: undefined }) } as any, 'a')).toHaveLength(0);
  });

  it('utilise la légende quand la photo est accompagnée d’un texte', () => {
    const events = connector.normalize({ headers: {}, rawBody: Buffer.from(''), body: update({ text: undefined, caption: 'Légende' }) } as any, 'a');
    expect(events[0].body).toBe('Légende');
  });

  it('poll : appelle getUpdates avec le curseur et avance l’offset', async () => {
    const calls = stubTelegram([update({ message_id: 42 }), { ...update({ message_id: 43 }), update_id: 1002 }]);
    const res = await connector.poll({
      accountId: 'acc-1',
      config: {},
      tokens: { botToken: 'token-test' },
      resources: { updates: '1001' },
    });
    expect(calls[0].url).toContain('/bottoken-test/getUpdates');
    expect(calls[0].body.offset).toBe(1001);
    expect(res.events).toHaveLength(2);
    expect(res.resourceCursors).toEqual([{ resource: 'updates', cursor: '1003' }]);
  });

  it('poll : refuse un jeton manquant', async () => {
    await expect(connector.poll({ accountId: 'a', config: {}, tokens: {} })).rejects.toThrow(/jeton de bot/);
  });

  it('reply : envoie un sendMessage dans la conversation d’origine', async () => {
    const calls = stubTelegram({ message_id: 77 });
    const res = await connector.reply({
      accountId: 'acc-1',
      config: {},
      tokens: { botToken: 'token-test' },
      to: ['987654321'],
      body: 'Ma réponse',
    });
    expect(calls[0].url).toContain('/sendMessage');
    expect(calls[0].body).toEqual({ chat_id: '987654321', text: 'Ma réponse' });
    expect(res.messageId).toBe('77');
  });

  it('test : renvoie le bot et signale un webhook actif', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = String(url).includes('getMe')
        ? { ok: true, result: { username: 'mon_bot' } }
        : { ok: true, result: { url: 'https://exemple.com/hook' } };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const res = (await connector.test({ accountId: 'a', config: {}, tokens: { botToken: 't' } })) as any;
    expect(res).toEqual({ bot: '@mon_bot', webhook: 'https://exemple.com/hook' });
  });

  it('verifyWebhook : accepte le bon secret, refuse le mauvais', () => {
    const req = (secret?: string) => ({
      headers: { 'x-telegram-bot-api-secret-token': secret },
      rawBody: Buffer.from(''),
      body: {},
    }) as any;
    expect(connector.verifyWebhook(req('s3cret'), 's3cret')).toBe(true);
    expect(connector.verifyWebhook(req('autre'), 's3cret')).toBe(false);
    expect(connector.verifyWebhook(req(undefined), 's3cret')).toBe(false);
  });
});
