import { useEffect, useState } from 'react';
import type { UnifiedEvent } from '@fil/shared';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'à l\'instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

export function Feed() {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);

  useEffect(() => {
    fetch('/api/events')
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {});

    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as UnifiedEvent;
        setEvents((prev) => [e, ...prev].slice(0, 100));
      } catch {}
    };
    return () => es.close();
  }, []);

  if (events.length === 0) {
    return <p className="empty">Aucun événement pour l'instant.</p>;
  }

  return (
    <ul className="feed-list">
      {events.map((e) => (
        <li key={e.id} className="event">
          <div className="event-header">
            <span className="event-connector">{e.connector}</span>
            <span className="event-time">{timeAgo(e.receivedAt)}</span>
          </div>
          {e.title && <div className="event-title">{e.title}</div>}
          <div className="event-body">{e.body}</div>
          {e.author?.name && <div className="event-author">— {e.author.name}</div>}
          {e.url && (
            <a className="event-link" href={e.url} target="_blank" rel="noreferrer">
              Ouvrir
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
