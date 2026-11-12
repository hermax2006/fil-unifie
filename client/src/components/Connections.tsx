import { useEffect, useState } from 'react';

type User = { id: string; email: string; accountId?: string } | null;
type Endpoint = { id: string; connectorId: string; url: string | null; active: boolean; createdAt: string };
type ConnectorConnection = {
  id: string;
  connectorId: string;
  active: boolean;
  config: { url?: string; host?: string; smtpHost?: string } | null;
  hasTokens: boolean;
  updatedAt: string;
  lastPolledAt?: string | null;
  lastRun?: { status: string; at: string; error: string | null } | null;
};

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
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [connConnectorId, setConnConnectorId] = useState('rss');
  const [connConfigUrl, setConnConfigUrl] = useState('');
  const [connHost, setConnHost] = useState('');
  const [connPort, setConnPort] = useState('993');
  const [connUser, setConnUser] = useState('');
  const [connPass, setConnPass] = useState('');
  const [connMailboxes, setConnMailboxes] = useState('INBOX');
  const [connSmtpHost, setConnSmtpHost] = useState('');
  const [connSmtpPort, setConnSmtpPort] = useState('465');
  const [connSmtpSecure, setConnSmtpSecure] = useState(true);
  const [connSmtpUser, setConnSmtpUser] = useState('');
  const [connSaving, setConnSaving] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [connTestingId, setConnTestingId] = useState<string | null>(null);
  const [connTestResults, setConnTestResults] = useState<Record<string, string>>({});

  async function loadEndpoints() {
    try {
      const q = !user ? `?accountId=${encodeURIComponent(accountId)}` : '';
      const res = await fetch(`/api/connections/webhook/endpoints${q}`, { credentials: 'include' });
      if (!res.ok) return;
      setEndpoints(await res.json());
    } catch {}
  }

  async function loadConnections() {
    try {
      const q = !user ? `?accountId=${encodeURIComponent(accountId)}` : '';
      const res = await fetch(`/api/connections/connector-connections${q}`, { credentials: 'include' });
      if (!res.ok) return;
      setConnections(await res.json());
    } catch {}
  }

  useEffect(() => {
    loadEndpoints();
    loadConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.accountId]);

  async function saveConnection() {
    setConnSaving(true);
    setConnError(null);
    try {
      let config: Record<string, unknown> | undefined;
      if (connConnectorId === 'rss' && connConfigUrl.trim()) {
        config = { url: connConfigUrl.trim() };
      }
      if (connConnectorId === 'imap') {
        if (!connHost.trim() || !connUser.trim()) throw new Error('Hôte et utilisateur IMAP requis');
        const mailboxes = connMailboxes.split(',').map((m) => m.trim()).filter(Boolean);
        config = {
          host: connHost.trim(),
          port: Number(connPort) || 993,
          secure: true,
          user: connUser.trim(),
          mailboxes: mailboxes.length > 0 ? mailboxes : ['INBOX'],
          smtpHost: connSmtpHost.trim() || undefined,
          smtpPort: Number(connSmtpPort) || undefined,
          smtpSecure: connSmtpSecure,
          smtpUser: connSmtpUser.trim() || undefined,
        };
      }

      const res = await fetch('/api/connections/connector-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ connectorId: connConnectorId, config, accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');

      if (connConnectorId === 'imap' && connPass.trim()) {
        const tokenRes = await fetch(`/api/connections/connector-connections/${data.id}/tokens`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tokens: { pass: connPass.trim() }, accountId }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error || 'Erreur enregistrement du mot de passe');
      }

      setConnConfigUrl('');
      setConnHost('');
      setConnUser('');
      setConnPass('');
      setConnMailboxes('INBOX');
      setConnSmtpHost('');
      setConnSmtpPort('465');
      setConnSmtpSecure(true);
      setConnSmtpUser('');
      loadConnections();
    } catch (e: any) {
      setConnError(e.message);
    } finally {
      setConnSaving(false);
    }
  }

  async function deleteConnection(id: string) {
    const q = user ? '' : `?accountId=${encodeURIComponent(accountId)}`;
    await fetch(`/api/connections/connector-connections/${id}${q}`, { method: 'DELETE', credentials: 'include' });
    loadConnections();
  }

  async function toggleConnection(id: string, active: boolean) {
    await fetch(`/api/connections/connector-connections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ active, accountId }),
    });
    loadConnections();
  }

  async function testConnection(id: string) {
    setConnTestingId(id);
    setConnTestResults((prev) => ({ ...prev, [id]: 'Test en cours...' }));
    try {
      const res = await fetch(`/api/connections/connector-connections/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      const result = data.result as { mailboxes?: string[]; missing?: string[] };
      const missing = result.missing?.length ? ` — dossiers absents : ${result.missing.join(', ')}` : '';
      const count = result.mailboxes?.length ? `${result.mailboxes.length} dossier(s)` : 'connexion OK';
      setConnTestResults((prev) => ({ ...prev, [id]: `OK : ${count}${missing}` }));
    } catch (e: any) {
      setConnTestResults((prev) => ({ ...prev, [id]: `Erreur : ${e.message}` }));
    } finally {
      setConnTestingId(null);
    }
  }

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

  async function rotate(id: string) {
    const res = await fetch(`/api/connections/webhook/endpoints/${id}/rotate-secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accountId }),
    });
    const data = await res.json();
    if (res.ok) {
      setResult({ ...data, url: '(URL inchangée, secret remplacé)', warning: data.warning });
      setTestResult(null);
    } else {
      setError(data.error || 'Erreur rotation');
    }
  }

  async function regenerate(id: string) {
    const res = await fetch(`/api/connections/webhook/endpoints/${id}/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accountId }),
    });
    const data = await res.json();
    if (res.ok) {
      setResult(data);
      setTestResult(null);
      loadEndpoints();
    } else {
      setError(data.error || 'Erreur régénération');
    }
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
                {ep.url ? (
                  <code className="value">{ep.url}</code>
                ) : (
                  <span className="value">URL masquée (jeton haché) — régénérer pour obtenir une nouvelle URL.</span>
                )}
              </div>
              {ep.active && (
                <div className="result-actions">
                  <button className="btn small" onClick={() => regenerate(ep.id)}>Régénérer URL + secret</button>
                  <button className="btn small" onClick={() => rotate(ep.id)}>Nouveau secret</button>
                  <button className="btn small danger" onClick={() => revoke(ep.id)}>Révoquer</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Connexions connecteurs (polling)</h3>
      <p className="hint">
        Pour les sources interrogées périodiquement (ex. flux RSS). Le serveur vérifie les connexions actives
        toutes les <code>POLL_INTERVAL_MS</code> (60 s par défaut).
      </p>

      <div className="form">
        <label>
          Connecteur
          <select value={connConnectorId} onChange={(e) => setConnConnectorId(e.target.value)}>
            <option value="rss">rss (RSS / Atom)</option>
            <option value="imap">imap (mail)</option>
            <option value="webhook">webhook (générique)</option>
            <option value="telegram">telegram</option>
            <option value="slack">slack</option>
          </select>
        </label>
        {connConnectorId === 'rss' && (
          <label>
            URL du flux
            <input
              value={connConfigUrl}
              onChange={(e) => setConnConfigUrl(e.target.value)}
              placeholder="https://exemple.com/flux.xml"
            />
          </label>
        )}
        {connConnectorId === 'imap' && (
          <>
            <label>
              Hôte IMAP
              <input value={connHost} onChange={(e) => setConnHost(e.target.value)} placeholder="imap.example.com" />
            </label>
            <label>
              Port
              <input value={connPort} onChange={(e) => setConnPort(e.target.value)} placeholder="993" />
            </label>
            <label>
              Utilisateur
              <input value={connUser} onChange={(e) => setConnUser(e.target.value)} placeholder="moi@example.com" />
            </label>
            <label>
              Dossiers (séparés par des virgules)
              <input value={connMailboxes} onChange={(e) => setConnMailboxes(e.target.value)} placeholder="INBOX, Archives" />
            </label>
            <label>
              Mot de passe d'application
              <input
                type="password"
                value={connPass}
                onChange={(e) => setConnPass(e.target.value)}
                placeholder="chiffré en BDD, jamais réaffiché"
              />
            </label>
            <label>
              Hôte SMTP (réponses)
              <input value={connSmtpHost} onChange={(e) => setConnSmtpHost(e.target.value)} placeholder="défaut : hôte IMAP" />
            </label>
            <label>
              Port SMTP
              <input value={connSmtpPort} onChange={(e) => setConnSmtpPort(e.target.value)} placeholder="465" />
            </label>
            <label>
              Utilisateur SMTP
              <input value={connSmtpUser} onChange={(e) => setConnSmtpUser(e.target.value)} placeholder="défaut : utilisateur IMAP" />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={connSmtpSecure} onChange={(e) => setConnSmtpSecure(e.target.checked)} />
              TLS direct (port 465)
            </label>
          </>
        )}
        <button className="btn" onClick={saveConnection} disabled={connSaving}>
          {connSaving ? 'Enregistrement...' : 'Ajouter la connexion'}
        </button>
      </div>

      {connError && <p className="error">{connError}</p>}

      {connections.length === 0 ? (
        <p className="hint">Aucune connexion polling pour ce compte.</p>
      ) : (
        <ul className="endpoint-list">
          {connections.map((c) => (
            <li key={c.id} className={`endpoint ${c.active ? '' : 'revoked'}`}>
              <div>
                <strong>{c.connectorId}</strong> <span className="badge">{c.active ? 'actif' : 'en pause'}</span>
                {c.config?.url && <code className="value">{c.config.url}</code>}
                {c.config?.host && <span className="value">IMAP : {c.config.host} — SMTP : {c.config.smtpHost || c.config.host}</span>}
                <span className="value">Tokens : {c.hasTokens ? 'présents (chiffrés)' : 'aucun'}</span>
                <span className="value">
                  Dernière sync : {c.lastPolledAt ? new Date(c.lastPolledAt).toLocaleString() : 'jamais'}
                  {c.lastRun?.status === 'error' && (
                    <span className="error small"> — échec : {c.lastRun.error}</span>
                  )}
                </span>
                {connTestResults[c.id] && (
                  <span className={connTestResults[c.id].startsWith('OK') ? 'success small' : 'error small'}>
                    {connTestResults[c.id]}
                  </span>
                )}
              </div>
              <div className="result-actions">
                {c.connectorId === 'imap' && (
                  <button className="btn small" onClick={() => testConnection(c.id)} disabled={connTestingId === c.id}>
                    {connTestingId === c.id ? 'Test...' : 'Tester'}
                  </button>
                )}
                <button className="btn small" onClick={() => toggleConnection(c.id, !c.active)}>
                  {c.active ? 'Mettre en pause' : 'Réactiver'}
                </button>
                <button className="btn small danger" onClick={() => deleteConnection(c.id)}>Supprimer</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
