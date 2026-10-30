import { useEffect, useState } from 'react';
import type { ConnectorInfo } from '@fil/shared';

export function Connectors() {
  const [items, setItems] = useState<ConnectorInfo[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/connectors')
      .then((r) => r.json())
      .then(setItems)
      .catch(() => {});
  }, []);

  function copyWebhook() {
    const url = `${window.location.origin}/webhooks/webhook/mon-compte`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="connectors">
      <h2>Applications</h2>
      <ul>
        {items.map((c) => (
          <li key={c.id} className={`connector ${c.status}`}>
            <div className="connector-main">
              <strong>{c.name}</strong>
              <span className="connector-meta">{c.category} · {c.access}</span>
            </div>
            {c.status === 'available' && c.id === 'webhook' && (
              <button className="btn" onClick={copyWebhook}>
                {copied ? 'Copié !' : 'Copier URL webhook'}
              </button>
            )}
            {c.status === 'soon' && <span className="badge">Bientôt</span>}
          </li>
        ))}
      </ul>
      <p className="hint">
        Pour le webhook générique : ajoute l'en-tête <code>x-webhook-secret: dev-secret</code> (en dev).
      </p>
    </div>
  );
}
