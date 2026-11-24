import { useEffect, useState } from 'react';
import { readJson } from '../api.js';

type User = { id: string; email: string; accountId?: string } | null;

const MAIL_PRESETS: Record<'gmail' | 'outlook', { host: string; port: string; smtpHost: string; smtpPort: string }> = {
  gmail: { host: 'imap.gmail.com', port: '993', smtpHost: 'smtp.gmail.com', smtpPort: '465' },
  outlook: { host: 'outlook.office365.com', port: '993', smtpHost: 'smtp.office365.com', smtpPort: '587' },
};
type MailProvider = 'gmail' | 'outlook' | 'other';

/**
 * Assistant de première connexion.
 * - Affiché seulement si l'utilisateur n'a AUCUNE connexion (polling ou webhook).
 * - Propose d'ajouter une boîte mail en 2 champs (adresse + mot de passe
 *   d'application) : Gmail/Outlook sont préconfigurés, les réglages techniques
 *   restent dans « Options avancées ». OAuth « Se connecter avec Google »
 *   arrivera en Phase 3.
 * - « Plus tard » est persisté (localStorage) pour ne pas reposer la question.
 */
export function Onboarding({ user, onClose, onFinish }: {
  user: User;
  onClose: () => void;
  onFinish: (tab: 'feed' | 'connections') => void;
}) {
  const [step, setStep] = useState<'welcome' | 'mail' | 'done'>('welcome');
  const [provider, setProvider] = useState<MailProvider>('gmail');
  const [host, setHost] = useState('imap.gmail.com');
  const [port, setPort] = useState('993');
  const [mailUser, setMailUser] = useState(user?.email ?? '');
  const [mailboxes, setMailboxes] = useState('INBOX');
  const [pass, setPass] = useState('');
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauth, setOauth] = useState({ google: false, microsoft: false });

  // Les boutons OAuth n'apparaissent que si le serveur a les identifiants.
  useEffect(() => {
    const availability = (path: string) =>
      fetch(path)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => !!data?.available)
        .catch(() => false);
    Promise.all([availability('/auth/google/available'), availability('/auth/microsoft/available')])
      .then(([google, microsoft]) => setOauth({ google, microsoft }));
  }, []);

  async function createMailbox() {
    setBusy(true);
    setError(null);
    try {
      const preset = provider === 'other' ? null : MAIL_PRESETS[provider];
      const config = {
        host: preset ? preset.host : host.trim(),
        port: preset ? Number(preset.port) : Number(port) || 993,
        secure: true,
        user: mailUser.trim(),
        mailboxes: mailboxes.split(',').map((m) => m.trim()).filter(Boolean),
        smtpHost: preset ? preset.smtpHost : smtpHost.trim(),
        smtpPort: preset ? Number(preset.smtpPort) : Number(smtpPort) || 465,
        smtpSecure: preset ? preset.smtpPort === '465' : smtpSecure,
      };
      if (!config.host) throw new Error('Hôte IMAP requis');
      const res = await fetch('/api/connections/connector-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ connectorId: 'imap', config, accountId: user?.accountId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

      if (pass.trim()) {
        const tokenRes = await fetch(`/api/connections/connector-connections/${data.id}/tokens`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tokens: { pass: pass.trim() }, accountId: user?.accountId }),
        });
        const tokenData = await readJson(tokenRes);
        if (!tokenRes.ok) throw new Error(tokenData.error || `Erreur ${tokenRes.status} (mot de passe)`);
      }
      setStep('done');
    } catch (e: any) {
      setError(e?.message || 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    if (user?.email) localStorage.setItem(`onboarding-dismissed-${user.email}`, '1');
    onClose();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Bienvenue">
      <div className="modal">
        <button className="modal-close btn small" onClick={dismiss} aria-label="Fermer">✕</button>

        {step === 'welcome' && (
          <>
            <h2 className="detail-title">Bienvenue dans Fil unifié 🎉</h2>
            <p className="info">
              Agrège tes messages de toutes tes applications dans un seul fil. Commence par
              connecter une application :
            </p>
            <div className="onboarding-options">
              <button className="option-card" onClick={() => setStep('mail')}>
                <span className="option-icon">✉️</span>
                <span className="option-title">Une boîte mail</span>
                <span className="option-desc">Gmail, Outlook, ou n'importe quel serveur IMAP — tes emails arrivent dans le fil.</span>
              </button>
              <button className="option-card" onClick={() => onFinish('connections')}>
                <span className="option-icon">🔗</span>
                <span className="option-title">Une autre app</span>
                <span className="option-desc">Webhook, RSS, Telegram… configure depuis l'onglet Connexions.</span>
              </button>
            </div>
            <p className="hint">
              Tu pourras ajouter d'autres applications plus tard, dans l'onglet « Connexions ».
            </p>
          </>
        )}

        {step === 'mail' && (
          <>
            <h2 className="detail-title">Ajouter une boîte mail</h2>
            {(oauth.google || oauth.microsoft) && (
              <div className="oauth-cta">
                {oauth.google && (
                  <button className="btn primary" onClick={() => { window.location.href = '/auth/google/start'; }}>
                    Se connecter avec Google
                  </button>
                )}
                {oauth.microsoft && (
                  <button className="btn" onClick={() => { window.location.href = '/auth/microsoft/start'; }}>
                    Se connecter avec Microsoft
                  </button>
                )}
                <span className="hint">Recommandé : aucun mot de passe à créer.</span>
              </div>
            )}
            <div className="form">
              <label>
                Fournisseur
                <select value={provider} onChange={(e) => setProvider(e.target.value as MailProvider)}>
                  <option value="gmail">Gmail</option>
                  <option value="outlook">Outlook / Microsoft 365</option>
                  <option value="other">Autre (IMAP)</option>
                </select>
              </label>
              <label>
                Adresse email
                <input type="email" value={mailUser} onChange={(e) => setMailUser(e.target.value)} autoComplete="email" />
              </label>
              <label className="full-width">
                Mot de passe d'application
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="16 caractères (pas ton mot de passe habituel)"
                  autoComplete="new-password"
                />
              </label>
              <details className="details">
                <summary>Options avancées</summary>
                {provider === 'other' && (
                  <>
                    <label>
                      Hôte IMAP
                      <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" />
                    </label>
                    <label>
                      Port IMAP
                      <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
                    </label>
                    <label>
                      Hôte SMTP (pour répondre)
                      <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
                    </label>
                    <label>
                      Port SMTP
                      <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} inputMode="numeric" />
                    </label>
                    <label className="checkbox">
                      <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                      TLS direct (port 465)
                    </label>
                  </>
                )}
                <label>
                  Dossiers (séparés par des virgules)
                  <input value={mailboxes} onChange={(e) => setMailboxes(e.target.value)} placeholder="INBOX" />
                </label>
                {provider !== 'other' && (
                  <p className="hint">
                    Serveurs utilisés automatiquement : {MAIL_PRESETS[provider].host} et {MAIL_PRESETS[provider].smtpHost}.
                  </p>
                )}
              </details>
            </div>

            {provider === 'gmail' && (
              <div className="onboard-help">
                <strong>📧 Mot de passe d'application Gmail</strong>
                <ol>
                  <li>
                    Active la <strong>validation en deux étapes</strong> :{' '}
                    <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer">myaccount.google.com/security</a>
                  </li>
                  <li>
                    Crée un <strong>mot de passe d'application</strong> (16 caractères) :{' '}
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>{' '}
                    — <em>connecté au bon compte Google</em>
                  </li>
                  <li>Colle-le ci-dessus. Les espaces sont retirés automatiquement.</li>
                </ol>
                <p className="hint">La connexion en 1 clic avec Google arrivera ensuite (OAuth).</p>
              </div>
            )}

            {error && <p className="error small">{error}</p>}
            <div className="result-actions">
              <button
                className="btn"
                onClick={createMailbox}
                disabled={busy || !mailUser.trim() || (provider === 'other' && !host.trim())}
              >
                {busy ? 'Ajout…' : 'Ajouter la boîte mail'}
              </button>
              <button className="btn" onClick={() => setStep('welcome')} disabled={busy}>Retour</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h2 className="detail-title">Boîte mail connectée ✅</h2>
            <p className="info">
              Le fil se remplit automatiquement : tes premiers emails arrivent dans
              <strong> ~1 minute</strong> (vérification toutes les 60 s).
            </p>
            <div className="result-actions">
              <button className="btn" onClick={() => onFinish('feed')}>Aller au fil</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
