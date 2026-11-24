import type { NewEvent } from '@fil/shared';
import { BaseConnector, type PollContext, type PollResult, type WebhookRequest } from './base.connector.js';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** « 12 mars 2026, 14:00 → 15:00 » (ou journée entière). */
function formatWhen(start?: string, end?: string): string | undefined {
  if (!start) return undefined;
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return start;
  const date = s.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  if (!end) return date;
  const e = new Date(end);
  if (Number.isNaN(e.getTime())) return date;
  const time = e.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} → ${time}`;
}

interface GcalItem {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  updated?: string;
  organizer?: { email?: string; displayName?: string };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/**
 * Google Calendar (API v3, lecture seule).
 * OAuth Google (scope `calendar.readonly`) : tokens chiffrés rafraîchis
 * automatiquement par le poller. On interroge les événements mis à jour
 * depuis la dernière synchronisation (marge d'une minute pour les fuseaux).
 */
export class GcalConnector extends BaseConnector {
  readonly info = {
    id: 'gcal',
    name: 'Google Calendar',
    category: 'Mail, agenda, fichiers',
    access: 'gratuit' as const,
    canReply: false,
    status: 'available' as const,
  };

  normalize(_req: WebhookRequest, _accountId: string): NewEvent[] {
    return [];
  }

  private async fetchEvents(ctx: PollContext, params: Record<string, string>): Promise<GcalItem[]> {
    const token = asString(ctx.tokens?.accessToken);
    if (!token) throw new Error('Google Agenda : connexion OAuth requise');
    const calendarId = asString(ctx.config.calendarId) ?? 'primary';
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Google Agenda: ${res.status} ${detail.slice(0, 160)}`.trim());
    }
    const data = (await res.json().catch(() => ({}))) as { items?: GcalItem[] };
    return Array.isArray(data.items) ? data.items : [];
  }

  async test(ctx: PollContext): Promise<Record<string, unknown>> {
    const items = await this.fetchEvents(ctx, { maxResults: '1', singleEvents: 'true' });
    return { ok: true, calendarId: asString(ctx.config.calendarId) ?? 'primary', sample: items.length };
  }

  async poll(ctx: PollContext): Promise<PollResult> {
    const since = ctx.resources?.['gcal:since'] ?? ctx.lastPolledAt;
    const params: Record<string, string> = {
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
      showDeleted: 'false',
      // Fenêtre : événements à venir et récents (les mises à jour passées restent visibles).
      timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    if (since) {
      const t = new Date(since);
      if (!Number.isNaN(t.getTime())) {
        params.updatedMin = new Date(t.getTime() - 60 * 1000).toISOString();
      }
    }

    const items = await this.fetchEvents(ctx, params);
    const now = new Date().toISOString();
    const events: NewEvent[] = [];

    for (const item of items) {
      if (!item.id || item.status === 'cancelled') continue;
      const start = item.start?.dateTime ?? item.start?.date;
      const end = item.end?.dateTime ?? item.end?.date;
      const body = [
        formatWhen(start, end),
        item.location ? `📍 ${item.location}` : undefined,
        item.description ? item.description.trim() : undefined,
      ].filter(Boolean).join('\n');
      events.push({
        connector: this.info.id,
        accountId: ctx.accountId,
        externalId: item.id,
        kind: 'task',
        author: item.organizer?.email
          ? { id: item.organizer.email, name: item.organizer.displayName ?? item.organizer.email }
          : undefined,
        title: item.summary?.trim() || '(sans titre)',
        body: body || 'Événement sans description',
        url: item.htmlLink,
        occurredAt: new Date(start ?? item.updated ?? now).toISOString(),
      });
    }

    return { events, resourceCursors: [{ resource: 'gcal:since', cursor: now }] };
  }
}
