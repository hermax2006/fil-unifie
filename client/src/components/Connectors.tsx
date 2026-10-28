import { useEffect, useState } from 'react';
import type { ConnectorInfo } from '@fil/shared';

export function Connectors() {
  const [list, setList] = useState<ConnectorInfo[]>([]);

  useEffect(() => {
    fetch('/api/connectors').then((r) => r.json()).then(setList).catch(console.error);
  }, []);

  return (
    <>
      <h2>Applications</h2>
      <ul className="connectors">
        {list.map((c) => (
          <li key={c.id} className={c.status}>
            <span>{c.name}</span>
            <small>{c.status === 'available' ? c.access : 'bientôt'}</small>
          </li>
        ))}
      </ul>
    </>
  );
}
