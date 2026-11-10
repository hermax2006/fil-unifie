import { useEffect, useMemo, useState } from 'react';
import type { UnifiedEvent } from '@fil/shared';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

export function Feed() {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [connector, setConnector] = useState('');
  const [kind, setKind] = useState('');
  const [read, setRead] = useState<'all' | 'read' | 'unread'>('all');

  async function load() {
    const qs = new URLSearchParams();
    if (connector) qs.set('connector', connector);
    if (kind) qs.set('kind', kind);
    if (read !== 'all') qs.set('read', read);
    const res = await fetch(`/api/events?${qs.toString()}`, { credentials: 'include' });
    if (res.ok) setEvents(await res.json());
  }

  useEffect(() => {
    load();
    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as UnifiedEvent;
        setEvents((prev) => {
          if (connector && e.connector !== connector) return prev;
          if (kind && e.kind !== kind) return prev;
          if (read === 'read') return prev;
          return [e, ...prev].slice(0, 100);
        });
      } catch {}
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector, kind, read]);

  const connectors = useMemo(() => Array.from(new Set(events.map((e) => e.connector))), [events]);

  async function markRead(id: string) {
    await fetch(`/api/events/${id}/read`, { method: 'POST', credentials: 'include' });
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, readAt: e.readAt || new Date().toISOString() } : e)));
  }

  return (
    <div className="feed-wrap">
      <div className="filters">
        <select value={connector} onChange={(e) => setConnector(e.target.value)}>
          <option value="">Tous connecteurs</option>
          {connectors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tous types</option>
          <option value="message">message</option>
          <option value="mention">mention</option>
          <option value="notification">notification</option>
          <option value="task">task</option>
          <option value="other">other</option>
        </select>
        <select value={read} onChange={(e) => setRead(e.target.value as any)}>
          <option value="all">Tous</option>
          <option value="unread">Non lus</option>
          <option value="read">Lus</option>
        </select>
        <button className="btn small" onClick={load}>Actualiser</button>
      </div>

      {events.length === 0 ? (
        <p className="empty">Aucun événement pour l'instant.</p>
      ) : (
        <ul className="feed-list">
          {events.map((e) => (
            <li key={e.id} className={`event ${e.readAt ? 'read' : 'unread'}`}>
              <div className="event-header">
                <span className="event-connector">{e.connector}</span>
                <span className="event-time">{timeAgo(e.receivedAt)}</span>
              </div>
              {e.title && <div className="event-title">{e.title}</div>}
              <div className="event-body">{e.body}</div>
              {e.attachments && e.attachments.length > 0 && (
                <div className="event-attachments">
                  <span className="attachment-label">Pièces jointes :</span>
                  {e.attachments.map((a, i) => (
                    <span className="attachment" key={`${a.filename}-${i}`}>
                      {a.filename}
                      {a.size ? ` (${Math.max(1, Math.round(a.size / 1024))} Ko)` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div className="event-footer">
                {e.author?.name && <span className="event-author">— {e.author.name}</span>}
                {e.url && <a className="event-link" href={e.url} target="_blank" rel="noreferrer">Ouvrir</a>}
                {!e.readAt && <button className="btn small" onClick={() => markRead(e.id)}>Marquer lu</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
