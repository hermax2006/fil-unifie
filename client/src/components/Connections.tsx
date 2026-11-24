import { useEffect, useState } from 'react';
import { readJson } from '../api.js';

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

/** Réglages techniques connus des grands fournisseurs : l'utilisateur n'a qu'à saisir son adresse. */
const MAIL_PRESETS: Record<'gmail' | 'outlook', { host: string; port: string; smtpHost: string; smtpPort: string; smtpSecure: boolean }> = {
  gmail: { host: 'imap.gmail.com', port: '993', smtpHost: 'smtp.gmail.com', smtpPort: '465', smtpSecure: true },
  outlook: { host: 'outlook.office365.com', port: '993', smtpHost: 'smtp.office365.com', smtpPort: '587', smtpSecure: false },
};
type MailProvider = 'gmail' | 'outlook' | 'other';

/**
 * Onglet "Connexions"
 * - Génère une URL webhook sécurisée (/webhooks/w/:path_token)
 * - Secret chiffré côté serveur, affiché UNE SEULE FOIS
 * - Liste + révocation des endpoints existants
 */
const SELECTABLE_CONNECTORS = new Set(['imap', 'telegram', 'rss', 'slack', 'webhook']);

export function Connections({ user, initialConnector }: { user?: User; initialConnector?: string | null }) {
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
  const [deliveries, setDeliveries] = useState<Record<string, any[] | 'loading' | null>>({});
  const [connConnectorId, setConnConnectorId] = useState('imap');
  const [connConfigUrl, setConnConfigUrl] = useState('');
  const [mailProvider, setMailProvider] = useState<MailProvider>('gmail');
  const [connHost, setConnHost] = useState('');
  const [connPort, setConnPort] = useState('993');
  const [connUser, setConnUser] = useState(user?.email ?? '');
  const [connPass, setConnPass] = useState('');
  const [connMailboxes, setConnMailboxes] = useState('INBOX');
  const [connSmtpHost, setConnSmtpHost] = useState('');
  const [connSmtpPort, setConnSmtpPort] = useState('465');
  const [connSmtpSecure, setConnSmtpSecure] = useState(true);
  const [connSmtpUser, setConnSmtpUser] = useState('');
  const [connBotToken, setConnBotToken] = useState('');
  const [connSaving, setConnSaving] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [connTestingId, setConnTestingId] = useState<string | null>(null);
  const [connTestResults, setConnTestResults] = useState<Record<string, string>>({});
  const [oauthProviders, setOauthProviders] = useState({ google: false, microsoft: false, slack: false });
  const [slackEndpoint, setSlackEndpoint] = useState<{ url: string; secret: string } | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);

  async function loadDeliveries(endpointId: string) {
    setDeliveries((prev) => ({ ...prev, [endpointId]: 'loading' }));
    try {
      const res = await fetch(`/api/connections/webhook/deliveries?endpointId=${endpointId}&accountId=${accountId}`, { credentials: 'include' });
      const data = await readJson(res);
      setDeliveries((prev) => ({ ...prev, [endpointId]: res.ok ? data : [{ error: data.error || `Erreur ${res.status}` }] }));
    } catch {
      setDeliveries((prev) => ({ ...prev, [endpointId]: [{ error: 'Erreur réseau' }] }));
    }
  }

  async function loadEndpoints() {
    try {
      const q = !user ? `?accountId=${encodeURIComponent(accountId)}` : '';
      const res = await fetch(`/api/connections/webhook/endpoints${q}`, { credentials: 'include' });
      if (!res.ok) return;
      setEndpoints(await readJson(res));
    } catch {}
  }

  async function loadConnections() {
    try {
      const q = !user ? `?accountId=${encodeURIComponent(accountId)}` : '';
      const res = await fetch(`/api/connections/connector-connections${q}`, { credentials: 'include' });
      if (!res.ok) return;
      setConnections(await readJson(res));
    } catch {}
  }

  useEffect(() => {
    if (initialConnector && SELECTABLE_CONNECTORS.has(initialConnector)) {
      setConnConnectorId(initialConnector);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConnector]);

  useEffect(() => {
    loadEndpoints();
    loadConnections();
    const availability = (path: string) =>
      fetch(path)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => !!data?.available)
        .catch(() => false);
    Promise.all([
      availability('/auth/google/available'),
      availability('/auth/microsoft/available'),
      availability('/auth/slack/available'),
    ]).then(([google, microsoft, slack]) => setOauthProviders({ google, microsoft, slack }));
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
        const preset = mailProvider === 'other' ? null : MAIL_PRESETS[mailProvider];
        const host = preset ? preset.host : connHost.trim();
        if (!connUser.trim()) throw new Error('Adresse email requise');
        if (!host) throw new Error('Hôte IMAP requis');
        const mailboxes = connMailboxes.split(',').map((m) => m.trim()).filter(Boolean);
        config = {
          host,
          port: preset ? Number(preset.port) : Number(connPort) || 993,
          secure: true,
          user: connUser.trim(),
          mailboxes: mailboxes.length > 0 ? mailboxes : ['INBOX'],
          smtpHost: preset ? preset.smtpHost : connSmtpHost.trim() || undefined,
          smtpPort: preset ? Number(preset.smtpPort) : Number(connSmtpPort) || undefined,
          smtpSecure: preset ? preset.smtpSecure : connSmtpSecure,
          smtpUser: connSmtpUser.trim() || undefined,
        };
      }

      const res = await fetch('/api/connections/connector-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ connectorId: connConnectorId, config, accountId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

      if (connConnectorId === 'telegram') {
        if (!connBotToken.trim()) throw new Error('Jeton du bot Telegram requis (@BotFather)');
        config = {};
      }

      if (connConnectorId === 'imap' && connPass.trim()) {
        const tokenRes = await fetch(`/api/connections/connector-connections/${data.id}/tokens`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tokens: { pass: connPass.trim() }, accountId }),
        });
        const tokenData = await readJson(tokenRes);
        if (!tokenRes.ok) throw new Error(tokenData.error || `Erreur ${tokenRes.status} (mot de passe)`);
      }
      if (connConnectorId === 'telegram' && connBotToken.trim()) {
        const tokenRes = await fetch(`/api/connections/connector-connections/${data.id}/tokens`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tokens: { botToken: connBotToken.trim() }, accountId }),
        });
        const tokenData = await readJson(tokenRes);
        if (!tokenRes.ok) throw new Error(tokenData.error || `Erreur ${tokenRes.status} (jeton bot)`);
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
      setConnBotToken('');
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

  async function changePassword(id: string, field = 'pass', label = "Nouveau mot de passe d'application (chiffré en BDD, jamais réaffiché)") {
    const pass = window.prompt(label);
    if (!pass?.trim()) return;
    const res = await fetch(`/api/connections/connector-connections/${id}/tokens`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tokens: { [field]: pass.trim() }, accountId }),
    });
    const data = await readJson(res);
    setConnTestResults((prev) => ({
      ...prev,
      [id]: res.ok ? 'OK : mot de passe mis à jour — reclique Tester' : `Erreur : ${data.error || res.status}`,
    }));
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
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      const result = data.result as { mailboxes?: string[]; missing?: string[]; bot?: string; webhook?: string | null };
      const missing = result.missing?.length ? ` — dossiers absents : ${result.missing.join(', ')}` : '';
      const count = result.mailboxes?.length ? `${result.mailboxes.length} dossier(s)` : 'connexion OK';
      const bot = result.bot ? `bot ${result.bot}` : count;
      const hook = result.bot ? (result.webhook ? ' — ⚠ webhook actif (incompatible avec le polling)' : ' — polling prêt') : '';
      setConnTestResults((prev) => ({ ...prev, [id]: `OK : ${bot}${hook}${missing}` }));
    } catch (e: any) {
      setConnTestResults((prev) => ({ ...prev, [id]: `Erreur : ${e.message}` }));
    } finally {
      setConnTestingId(null);
    }
  }

  async function generate(targetConnector: string = connectorId) {
    setLoading(true);
    setError(null);
    setResult(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/connections/webhook/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId, connectorId: targetConnector }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        if (res.status === 401) throw new Error('Non authentifié. Connecte-toi d\'abord.');
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      setResult(data);
      loadEndpoints();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function createSlackWebhook() {
    setSlackLoading(true);
    setConnError(null);
    try {
      const res = await fetch('/api/connections/webhook/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accountId, connectorId: 'slack' }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setSlackEndpoint({ url: data.url, secret: data.secret });
      loadEndpoints();
    } catch (e: any) {
      setConnError(e.message);
    } finally {
      setSlackLoading(false);
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
      const data = await readJson(res);
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
    const data = await readJson(res);
    if (res.ok) {
      setResult({ ...data, url: '(URL inchangée, secret remplacé)', warning: data.warning });
      setTestResult(null);
    } else {
      setError(data.error || `Erreur rotation ${res.status}`);
    }
  }

  async function regenerate(id: string) {
    const res = await fetch(`/api/connections/webhook/endpoints/${id}/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accountId }),
    });
    const data = await readJson(res);
    if (res.ok) {
      setResult(data);
      setTestResult(null);
      loadEndpoints();
    } else {
      setError(data.error || `Erreur régénération ${res.status}`);
    }
  }

  return (
    <div className="connections">
      <h2>Mes applications</h2>

      <h3>Ajouter une application</h3>
      <p className="hint">
        Choisis une app, saisis ton adresse et ton mot de passe d'application : le reste est préconfiguré.
        Le fil vérifie les sources actives toutes les <code>60 s</code>.
      </p>

      <div className="form">
        <label>
          Connecteur
          <select value={connConnectorId} onChange={(e) => {
            const v = e.target.value;
            setConnConnectorId(v);
            if (v === 'imap' && !connUser && user?.email) setConnUser(user.email);
          }}>
            <option value="imap">Messagerie (Gmail, Outlook, IMAP)</option>
            <option value="telegram">Telegram (bot)</option>
            <option value="rss">Flux RSS / Atom</option>
            <option value="slack">Slack</option>
            <option value="webhook">Webhook générique</option>
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
            {(oauthProviders.google || oauthProviders.microsoft) && (
              <div className="oauth-cta">
                {oauthProviders.google && (
                  <button className="btn" onClick={() => { window.location.href = '/auth/google/start'; }}>
                    Se connecter avec Google
                  </button>
                )}
                {oauthProviders.microsoft && (
                  <button className="btn" onClick={() => { window.location.href = '/auth/microsoft/start'; }}>
                    Se connecter avec Microsoft
                  </button>
                )}
                <span className="hint">Recommandé — aucun mot de passe à créer.</span>
              </div>
            )}
            <label>
              Fournisseur de messagerie
              <select value={mailProvider} onChange={(e) => setMailProvider(e.target.value as MailProvider)}>
                <option value="gmail">Gmail</option>
                <option value="outlook">Outlook / Microsoft 365</option>
                <option value="other">Autre (IMAP)</option>
              </select>
            </label>
            <label className="full-width">
              Adresse email
              <input
                type="email"
                value={connUser}
                onChange={(e) => setConnUser(e.target.value)}
                placeholder="moi@gmail.com"
                autoComplete="email"
              />
            </label>
            <label className="full-width">
              Mot de passe d'application
              <input
                type="password"
                value={connPass}
                onChange={(e) => setConnPass(e.target.value)}
                placeholder="chiffré en BDD, jamais réaffiché"
                autoComplete="new-password"
              />
              {mailProvider === 'gmail' && (
                <span className="hint">
                  Pas ton mot de passe Gmail habituel : crée un{' '}
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                    mot de passe d'application
                  </a>{' '}
                  (16 caractères, validation en deux étapes requise).
                </span>
              )}
              {mailProvider === 'outlook' && (
                <span className="hint">
                  Utilise ton mot de passe de compte Microsoft (ou un mot de passe d'application si activé).
                </span>
              )}
            </label>
            <details className="details">
              <summary>Options avancées</summary>
              {mailProvider === 'other' && (
                <>
                  <label>
                    Hôte IMAP
                    <input value={connHost} onChange={(e) => setConnHost(e.target.value)} placeholder="imap.example.com" />
                  </label>
                  <label>
                    Port IMAP
                    <input value={connPort} onChange={(e) => setConnPort(e.target.value)} inputMode="numeric" placeholder="993" />
                  </label>
                  <label>
                    Hôte SMTP (réponses)
                    <input value={connSmtpHost} onChange={(e) => setConnSmtpHost(e.target.value)} placeholder="smtp.example.com" />
                  </label>
                  <label>
                    Port SMTP
                    <input value={connSmtpPort} onChange={(e) => setConnSmtpPort(e.target.value)} inputMode="numeric" placeholder="465" />
                  </label>
                  <label>
                    Utilisateur SMTP
                    <input value={connSmtpUser} onChange={(e) => setConnSmtpUser(e.target.value)} placeholder="défaut : adresse email" />
                  </label>
                  <label className="checkbox">
                    <input type="checkbox" checked={connSmtpSecure} onChange={(e) => setConnSmtpSecure(e.target.checked)} />
                    TLS direct (port 465)
                  </label>
                </>
              )}
              <label>
                Dossiers (séparés par des virgules)
                <input value={connMailboxes} onChange={(e) => setConnMailboxes(e.target.value)} placeholder="INBOX" />
              </label>
              {mailProvider !== 'other' && (
                <p className="hint">
                  Serveurs utilisés automatiquement : {MAIL_PRESETS[mailProvider].host} et {MAIL_PRESETS[mailProvider].smtpHost}.
                </p>
              )}
            </details>
          </>
        )}
        {connConnectorId === 'slack' && (
          <>
            <div className="oauth-cta">
              {oauthProviders.slack ? (
                <button className="btn" onClick={() => { window.location.href = '/auth/slack/start'; }}>
                  Ajouter à Slack
                </button>
              ) : (
                <span className="hint">OAuth Slack non configuré sur ce serveur (SLACK_CLIENT_ID / SECRET).</span>
              )}
              <span className="hint">Installe l'app sur ton espace de travail pour autoriser la lecture et les réponses.</span>
            </div>
            <p className="hint">
              1. Crée l'URL de réception ci-dessous. 2. Dans api.slack.com → Event Subscriptions →
              Request URL, colle-la. 3. Abonne les événements bot <code>message.channels</code> et
              <code>app_mention</code>. 4. Ajoute le Signing Secret dans <code>SLACK_SIGNING_SECRET</code>.
            </p>
            <button className="btn" onClick={createSlackWebhook} disabled={slackLoading}>
              {slackLoading ? 'Création...' : "Créer l'URL de réception Slack"}
            </button>
            {slackEndpoint && (
              <div className="result">
                <div className="result-row">
                  <span className="label">Request URL</span>
                  <code className="value">{slackEndpoint.url}</code>
                  <button className="btn small" onClick={() => copy(slackEndpoint.url, 'url')}>
                    {copied === 'url' ? 'Copié !' : 'Copier'}
                  </button>
                </div>
                <p className="warning">
                  Signing secret (affiché une seule fois) : <code>{slackEndpoint.secret}</code> — à mettre
                  dans <code>SLACK_SIGNING_SECRET</code> côté serveur.
                </p>
              </div>
            )}
          </>
        )}
        {connConnectorId === 'telegram' && (
          <label>
            Jeton du bot
            <input
              type="password"
              value={connBotToken}
              onChange={(e) => setConnBotToken(e.target.value)}
              placeholder="123456789:AA… — chiffré en BDD, jamais réaffiché"
            />
            <span className="hint">
              Ouvre <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, envoie
              <code>/newbot</code>, choisis un nom, puis colle ici le jeton qu'il renvoie. Le fil lit les messages
              par polling (aucun domaine public requis).
            </span>
          </label>
        )}
        {connConnectorId !== 'slack' && (
          <button className="btn" onClick={saveConnection} disabled={connSaving}>
            {connSaving ? 'Enregistrement...' : "Ajouter l'application"}
          </button>
        )}
      </div>

      {connError && <p className="error">{connError}</p>}

      {connections.length === 0 ? (
        <p className="hint">Aucune application connectée pour l'instant.</p>
      ) : (
        <ul className="endpoint-list">
          {connections.map((c) => (
            <li key={c.id} className={`endpoint ${c.active ? '' : 'revoked'}`}>
              <div>
                <strong>{c.connectorId}</strong> <span className="badge">{c.active ? 'actif' : 'en pause'}</span>
                {c.config?.url && <code className="value">{c.config.url}</code>}
                {c.config?.host && <span className="value">IMAP : {c.config.host} — SMTP : {c.config.smtpHost || c.config.host}</span>}
                {c.connectorId === 'telegram' && <span className="value">Bot Telegram (jeton chiffré) — lecture par polling</span>}
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
                {(c.connectorId === 'imap' || c.connectorId === 'telegram') && (
                  <button className="btn small" onClick={() => testConnection(c.id)} disabled={connTestingId === c.id}>
                    {connTestingId === c.id ? 'Test...' : 'Tester'}
                  </button>
                )}
                {c.connectorId === 'imap' && c.hasTokens && (
                  <button className="btn small" onClick={() => changePassword(c.id)}>Changer le mot de passe</button>
                )}
                {c.connectorId === 'telegram' && c.hasTokens && (
                  <button className="btn small" onClick={() => changePassword(c.id, 'botToken', 'Nouveau jeton du bot Telegram (chiffré en BDD)')}>
                    Changer le jeton
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

      {oauthProviders.google && !connections.some((c) => c.connectorId === 'gcal') && (
        <div className="oauth-cta">
          <button className="btn" onClick={() => { window.location.href = '/auth/google/calendar/start'; }}>
            Connecter Google Agenda
          </button>
          <span className="hint">Tes rendez-vous apparaissent dans le fil (lecture seule).</span>
        </div>
      )}

      <details className="details advanced">
        <summary>Avancé — webhooks (développeurs)</summary>

        <h3>Webhooks (développeurs)</h3>
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
          <button className="btn" onClick={() => generate()} disabled={loading}>
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
                <details className="deliveries" onToggle={(e) => {
                  const el = e.currentTarget as HTMLDetailsElement;
                  if (el.open && !deliveries[ep.id]) void loadDeliveries(ep.id);
                }}>
                  <summary>Historique des réceptions</summary>
                  {deliveries[ep.id] === 'loading' && <p className="hint">Chargement…</p>}
                  {Array.isArray(deliveries[ep.id]) && (deliveries[ep.id] as any[]).length === 0 && (
                    <p className="hint">Aucune réception enregistrée.</p>
                  )}
                  {Array.isArray(deliveries[ep.id]) && (deliveries[ep.id] as any[]).map((d, i) => (
                    <div key={i} className="outbound-item">
                      <div className="outbound-head">
                        <span className={d.status === 'accepted' ? 'outbound-status sent' : 'outbound-status failed'}>
                          {d.status === 'accepted' ? `✅ accepté (${d.eventsCount ?? 0} événement${(d.eventsCount ?? 0) > 1 ? 's' : ''})` : '❌ rejeté'}
                        </span>
                        <span className="outbound-date">{new Date(d.createdAt).toLocaleString()}</span>
                      </div>
                      {d.error && <div className="error small">{d.error}</div>}
                    </div>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
