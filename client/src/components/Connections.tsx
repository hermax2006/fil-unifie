import { useState } from 'react';

export function Connections() {
  const [accountId, setAccountId] = useState('mon-compte');
  const [connectorId, setConnectorId] = useState('webhook');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/connections/webhook/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId, connectorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function copyUrl() {
    if (!result?.url) return;
    navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function copySecret() {
    if (!result?.secret) return;
    navigator.clipboard.writeText(result.secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="connections">
      <h2>Gérer les connexions</h2>
      <p className="hint">
        Génère une URL webhook sécurisée avec un <code>path_token</code>. Le secret est chiffré en base et n'apparaît qu'une seule fois.
      </p>

      <div className="form">
        <label>
          ID du compte
          <input value={accountId} onChange={(e) => setAccountId(e.target.value)} />
        </label>
        <label>
          Connecteur
          <select value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
            <option value="webhook">webhook (générique)</option>
            <option value="telegram">telegram</option>
            <option value="slack">slack</option>
          </select>
        </label>
        <button className="btn" onClick={generate} disabled={loading}>
          {loading ? 'Génération...' : 'Générer une URL webhook'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result">
          <div className="result-row">
            <span className="label">URL webhook</span>
            <code className="value">{result.url}</code>
            <button className="btn small" onClick={copyUrl}>{copied ? 'Copié !' : 'Copier'}</button>
          </div>
          <div className="result-row">
            <span className="label">Secret (à garder)</span>
            <code className="value secret">{result.secret}</code>
            <button className="btn small" onClick={copySecret}>{copied ? 'Copié !' : 'Copier'}</button>
          </div>
          <p className="warning">{result.warning}</p>
          <p className="hint">
            Ajoute ce secret dans l'en-tête attendu par ton connecteur (ex. <code>x-webhook-secret</code> pour le webhook générique).
          </p>
        </div>
      )}
    </div>
  );
}
