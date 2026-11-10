import { afterEach, describe, expect, it, vi } from 'vitest';
import { RssConnector } from '../connectors/rss.connector.js';

const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test</title>
  <item>
    <title>Hello &amp; World</title>
    <link>https://example.com/a</link>
    <description><![CDATA[<p>Premier <b>article</b></p>]]></description>
    <guid>a-1</guid>
    <pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Deuxième</title>
    <link>https://example.com/b</link>
    <description>Deuxième article</description>
    <pubDate>Tue, 10 Nov 2026 11:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200 })));
}

afterEach(() => vi.unstubAllGlobals());

describe('RssConnector.poll', () => {
  it('normalise les items RSS en événements', async () => {
    stubFetch();
    const connector = new RssConnector();
    const result = await connector.poll({
      accountId: 'acc',
      config: { url: 'https://example.com/feed.xml' },
      tokens: null,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      connector: 'rss',
      accountId: 'acc',
      externalId: 'a-1',
      title: 'Hello & World',
      body: 'Premier article',
      url: 'https://example.com/a',
      kind: 'notification',
    });
    expect(result.events[0].occurredAt).toBe('2026-11-10T10:00:00.000Z');
  });

  it('ignore les items antérieurs à lastPolledAt', async () => {
    stubFetch();
    const connector = new RssConnector();
    const result = await connector.poll({
      accountId: 'acc',
      config: { url: 'https://example.com/feed.xml' },
      tokens: null,
      lastPolledAt: '2026-11-10T10:30:00.000Z',
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Deuxième');
  });

  it('refuse une URL non http(s)', async () => {
    const connector = new RssConnector();
    await expect(connector.poll({
      accountId: 'acc',
      config: { url: 'file:///etc/passwd' },
      tokens: null,
    })).rejects.toThrow(/http\(s\)/);
  });
});
