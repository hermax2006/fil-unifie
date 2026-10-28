import { useEffect, useState } from 'react';
import type { UnifiedEvent } from '@fil/shared';

export function Feed() {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);

  useEffect(() => {
    fetch('/api/events').then((r) => r.json()).then(setEvents).catch(console.error);

    // Nouveaux événements en direct (SSE)
    const es = new EventSource('/api/stream');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as UnifiedEvent;
      setEvents((prev) => [e, ...prev]);
    };
    return () => es.close();
  }, []);

  if (events.length === 0) {
    return <p className="empty">Rien pour l'instant. Envoie un webhook de test (voir le README).</p>;
  }

  return (
    <ul className="events">
      {events.map((e) => (
        <li key={e.id}>
          <div className="meta">
            <strong>{e.author?.name ?? e.connector}</strong>
            <span>{e.connector}</span>
            <time dateTime={e.occurredAt}>{new Date(e.occurredAt).toLocaleTimeString('fr-FR')}</time>
          </div>
          {e.title && <div className="title">{e.title}</div>}
          <p>{e.body}</p>
        </li>
      ))}
    </ul>
  );
}
