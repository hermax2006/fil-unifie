import { useEffect, useState } from 'react';

type User = { id: string; email: string; accountId?: string } | null;
type Endpoint = { id: string; connectorId: string; url: string; active: boolean; createdAt: string };

/**
 * Onglet "Connexions"
 * - Génère une URL webhook sécurisée (/webhooks/w/:path_token)
 * - Secret chiffré côté serveur, affiché UNE SEULE FOIS
 * - Liste + révocation des endpoints existants
 */
export function Connections({ user }: { user?: User }) {
  const [accountId, setAccountId] = useState('mon-compte');
  const [connectorId, setConnectorId] = useState('webhook');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'url' | 'secret' | 'curl' | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);

  async function loadEndpoints() {
    try {
      const q = !user ? `?accountId=${encodeURIComponent(accountId)}` : '';
      const res = await fetch(`/api/connections/webhook/endpoints${q}`, { credentials: 'include' });
      if (!res.ok) return;
      setEndpoints(await res.json());
    } catch {}
  }

  useEffect(() => {
    loadEndpoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.accountId]);

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/connections/webhook/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId, connectorId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) throw new Error('Non authentifié. Connecte-toi d\'abord.');
        throw new Error(data.error || 'Erreur');
      }
      setResult(data);
      loadEndpoints();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string, kind: 'url' | 'secret' | 'curl') {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  function curlCommand() {
    if (!result) return '';
    const header = connectorId === 'telegram' ? 'x-telegram-bot-api-secret-token' : 'x-webhook-secret';
    return `curl -X POST "${result.url}" \\
  -H "Content-Type: application/json" \\
  -H "${header}: ${result.secret}" \\
  -d '{"kind":"message","title":"Test","body":"Bonjour depuis mon webhook","author":"moi"}'`;
  }

  async function sendTest() {
    if (!result) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const header = connectorId === 'telegram' ? 'x-telegram-bot-api-secret-token' : 'x-webhook-secret';
      const res = await fetch(result.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [header]: result.secret },
        body: JSON.stringify({ kind: 'message', title: 'Test depuis l\'UI', body: 'Ceci est un test envoyé depuis l\'onglet Connexions', author: 'ui' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setTestResult(`OK : ${data.accepted ?? 1} événement accepté. Va voir l'onglet Fil.`);
    } catch (e: any) {
      setTestResult(`Erreur : ${e.message}`);
    } finally {
      setTestLoading(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/connections/webhook/endpoints/${id}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accountId }),
    });
    loadEndpoints();
  }

  return (
    <div className="connections">
      <h2>Gérer les connexions</h2>
      <p className="hint">
        URLs sécurisées via <code>/webhooks/w/:path_token</code>. Secret chiffré (AES-256-GCM), affiché une seule fois.
      </p>

      <div className="form">
        {!user && (
          <label>
            ID du compte (dev)
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="mon-compte" />
          </label>
        )}
        {user && <div className="info">Compte lié : <code>{user.accountId ?? '—'}</code> ({user.email})</div>}
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
            <button className="btn small" onClick={() => copy(result.url, 'url')}>{copied === 'url' ? 'Copié !' : 'Copier'}</button>
          </div>
          <div className="result-row">
            <span className="label">Secret</span>
            <code className="value secret">{result.secret}</code>
            <button className="btn small" onClick={() => copy(result.secret, 'secret')}>{copied === 'secret' ? 'Copié !' : 'Copier'}</button>
          </div>
          <p className="warning">{result.warning}</p>
          <div className="result-actions">
            <button className="btn" onClick={sendTest} disabled={testLoading}>{testLoading ? 'Envoi...' : 'Envoyer un webhook de test'}</button>
            <button className="btn" onClick={() => copy(curlCommand(), 'curl')}>{copied === 'curl' ? 'Copié !' : 'Copier curl'}</button>
          </div>
          {testResult && <p className={testResult.startsWith('OK') ? 'success' : 'error'}>{testResult}</p>}
          <details className="details"><summary>Voir la commande curl</summary><pre className="code-block">{curlCommand()}</pre></details>
        </div>
      )}

      <h3>Endpoints existants</h3>
      {endpoints.length === 0 ? (
        <p className="hint">Aucun endpoint pour ce compte.</p>
      ) : (
        <ul className="endpoint-list">
          {endpoints.map((ep) => (
            <li key={ep.id} className={`endpoint ${ep.active ? '' : 'revoked'}`}>
              <div>
                <strong>{ep.connectorId}</strong> <span className="badge">{ep.active ? 'actif' : 'révoqué'}</span>
                <code className="value">{ep.url}</code>
              </div>
              {ep.active && <button className="btn small danger" onClick={() => revoke(ep.id)}>Révoquer</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
