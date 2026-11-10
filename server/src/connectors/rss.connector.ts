import type { NewEvent } from '@fil/shared';
import { BaseConnector, type PollContext, type PollResult, type WebhookRequest } from './base.connector.js';

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(xml: string, name: string): string | undefined {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = xml.match(re);
  if (!m) return undefined;
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

function atomLink(xml: string): string | undefined {
  const m = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return m?.[1];
}

function items(xml: string): string[] {
  const out: string[] = [];
  for (const re of [/<item\b[^>]*>([\s\S]*?)<\/item>/gi, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) out.push(m[1]);
  }
  return out;
}

function toIso(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

/** Connecteur RSS/Atom : interroge périodiquement une URL de flux. */
export class RssConnector extends BaseConnector {
  readonly info = {
    id: 'rss',
    name: 'Flux RSS / Atom',
    category: 'Standards universels',
    access: 'gratuit' as const,
    canReply: false,
    status: 'available' as const,
  };

  normalize(_req: WebhookRequest, _accountId: string): NewEvent[] {
    return [];
  }

  async poll(ctx: PollContext): Promise<PollResult> {
    const rawUrl = typeof ctx.config.url === 'string' ? ctx.config.url : '';
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('config.url invalide (URL RSS/Atom attendue)');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('config.url doit être en http(s)');
    }

    const res = await fetch(url, {
      headers: { 'user-agent': 'FilUnifie/0.1 (+rss)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`flux RSS: HTTP ${res.status}`);
    const xml = await res.text();
    const now = new Date().toISOString();
    const events: NewEvent[] = [];

    for (const item of items(xml).slice(0, 20)) {
      const title = stripTags(tag(item, 'title') ?? '');
      const link = tag(item, 'link') ?? atomLink(item);
      const description = tag(item, 'description') ?? tag(item, 'summary') ?? tag(item, 'content') ?? '';
      const body = stripTags(description) || title;
      if (!body) continue;

      const occurredAt = toIso(tag(item, 'pubDate') ?? tag(item, 'updated') ?? tag(item, 'published'), now);
      if (ctx.lastPolledAt && occurredAt <= ctx.lastPolledAt) continue;

      events.push({
        connector: this.info.id,
        accountId: ctx.accountId,
        externalId: tag(item, 'guid') ?? link ?? `${title}|${occurredAt}`,
        kind: 'notification',
        title: title || undefined,
        body,
        url: link,
        occurredAt,
      });
    }

    return { events, cursor: now };
  }
}
