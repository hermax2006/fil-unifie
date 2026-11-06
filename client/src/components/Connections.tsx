import { useState } from 'react';

/**
 * Onglet "Connexions"
 * - Permet de générer une URL webhook sécurisée (/webhooks/w/:path_token)
 * - Le secret est chiffré côté serveur et affiché UNE SEULE FOIS
 * - En dev, pas besoin d'être connecté. En prod, auth requise.
 */
export function Connections() {
  const [accountId, setAccountId] = useState('mon-compte');
  const [connectorId, setConnectorId] = useState('webhook');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'url' | 'secret' | 'curl' | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

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
        if (res.status === 401) throw new Error('Non authentifié. Connecte-toi d\'abord (étape auth).');
        throw new Error(data.error || 'Erreur');
      }
      setResult(data);
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
        headers: {
          'Content-Type': 'application/json',
          [header]: result.secret,
        },
        body: JSON.stringify({
          kind: 'message',
          title: 'Test depuis l\'UI',
          body: 'Ceci est un test envoyé depuis l\'onglet Connexions',
          author: 'ui',
        }),
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

  return (
    <div className="connections">
      <h2>Gérer les connexions</h2>
      <p className="hint">
        Génère une URL webhook sécurisée avec un <code>path_token</code> (plus d'ID compte dans l'URL).
        Le secret est chiffré en base (AES-256-GCM) et n'apparaît qu'une seule fois.
      </p>

      <div className="form">
        <label>
          ID du compte
          <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="mon-compte" />
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
            <button className="btn small" onClick={() => copy(result.url, 'url')}>
              {copied === 'url' ? 'Copié !' : 'Copier'}
            </button>
          </div>
          <div className="result-row">
            <span className="label">Secret (à garder)</span>
            <code className="value secret">{result.secret}</code>
            <button className="btn small" onClick={() => copy(result.secret, 'secret')}>
              {copied === 'secret' ? 'Copié !' : 'Copier'}
            </button>
          </div>
          <p className="warning">{result.warning}</p>

          <div className="result-actions">
            <button className="btn" onClick={sendTest} disabled={testLoading}>
              {testLoading ? 'Envoi...' : 'Envoyer un webhook de test'}
            </button>
            <button className="btn" onClick={() => copy(curlCommand(), 'curl')}>
              {copied === 'curl' ? 'Copié !' : 'Copier la commande curl'}
            </button>
          </div>

          {testResult && <p className={testResult.startsWith('OK') ? 'success' : 'error'}>{testResult}</p>}

          <details className="details">
            <summary>Voir la commande curl</summary>
            <pre className="code-block">{curlCommand()}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
