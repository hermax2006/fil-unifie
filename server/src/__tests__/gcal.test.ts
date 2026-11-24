import { afterEach, describe, expect, it, vi } from 'vitest';
import { GcalConnector } from '../connectors/gcal.connector.js';

const connector = new GcalConnector();

function stubCalendar(items: unknown[], ok = true, status = 200) {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(new URL(String(url)));
    return new Response(JSON.stringify(ok ? { items } : { error: { message: 'boom' } }), { status });
  }));
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('GcalConnector', () => {
  it('convertit les événements en entrées du fil (date, lieu, description)', async () => {
    stubCalendar([
      {
        id: 'evt-1',
        summary: 'Réunion équipe',
        location: 'Salle 2',
        description: 'Point hebdo',
        htmlLink: 'https://calendar.google.com/event?eid=1',
        organizer: { email: 'boss@example.com', displayName: 'Patron' },
        start: { dateTime: '2026-03-12T14:00:00+01:00' },
        end: { dateTime: '2026-03-12T15:00:00+01:00' },
      },
      { id: 'evt-2', status: 'cancelled', summary: 'Annulé' },
    ]);
    const result = await connector.poll({
      accountId: 'acc-1',
      config: { calendarId: 'primary' },
      tokens: { accessToken: 'at' },
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      connector: 'gcal',
      externalId: 'evt-1',
      kind: 'task',
      title: 'Réunion équipe',
      url: 'https://calendar.google.com/event?eid=1',
      author: { id: 'boss@example.com', name: 'Patron' },
    });
    expect(result.events[0].body).toContain('Salle 2');
    expect(result.events[0].body).toContain('Point hebdo');
    expect(result.resourceCursors?.[0].resource).toBe('gcal:since');
  });

  it('utilise updatedMin au tour suivant (curseur)', async () => {
    const urls = stubCalendar([]);
    await connector.poll({
      accountId: 'acc-1',
      config: {},
      tokens: { accessToken: 'at' },
      resources: { 'gcal:since': '2026-03-10T12:00:00.000Z' },
    });
    expect(urls[0].searchParams.get('updatedMin')).toBe('2026-03-10T11:59:00.000Z');
    expect(urls[0].searchParams.get('singleEvents')).toBe('true');
    expect(urls[0].pathname).toContain('/calendars/primary/events');
  });

  it('exige une connexion OAuth', async () => {
    await expect(connector.poll({ accountId: 'acc-1', config: {}, tokens: null }))
      .rejects.toThrow('connexion OAuth requise');
  });
});
