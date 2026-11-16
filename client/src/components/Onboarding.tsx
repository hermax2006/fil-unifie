import { useState } from 'react';
import { readJson } from '../api.js';

type User = { id: string; email: string; accountId?: string } | null;

/**
 * Assistant de première connexion.
 * - Affiché seulement si l'utilisateur n'a AUCUNE connexion (polling ou webhook).
 * - Propose d'ajouter une boîte mail (IMAP) en pas-à-pas, avec aide pour le
 *   mot de passe d'application Google, ou de passer par les Connexions.
 * - « Plus tard » est persisté (localStorage) pour ne pas reposer la question
 *   à chaque chargement tant qu'il n'y a pas de connexion.
 */
export function Onboarding({ user, onClose, onFinish }: {
  user: User;
  onClose: () => void;
  onFinish: (tab: 'feed' | 'connections') => void;
}) {
  const [step, setStep] = useState<'welcome' | 'mail' | 'done'>('welcome');
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

  async function createMailbox() {
    setBusy(true);
    setError(null);
    try {
      const config = {
        host: host.trim(),
        port: Number(port) || 993,
        secure: true,
        user: mailUser.trim(),
        mailboxes: mailboxes.split(',').map((m) => m.trim()).filter(Boolean),
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || 465,
        smtpSecure,
      };
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
            <div className="form">
              <label>
                Hôte IMAP
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com" />
              </label>
              <label>
                Port
                <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
              </label>
              <label>
                Adresse email
                <input value={mailUser} onChange={(e) => setMailUser(e.target.value)} />
              </label>
              <label>
                Dossiers (séparés par des virgules)
                <input value={mailboxes} onChange={(e) => setMailboxes(e.target.value)} placeholder="INBOX" />
              </label>
              <label className="full-width">
                Mot de passe d'application
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="16 caractères (pas ton mot de passe habituel)"
                />
              </label>
              <label>
                Hôte SMTP (pour répondre)
                <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
              </label>
              <label>
                Port SMTP
                <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} inputMode="numeric" />
              </label>
            </div>

            <div className="onboard-help">
              <strong>📧 Tu utilises Gmail ?</strong>
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
            </div>

            {error && <p className="error small">{error}</p>}
            <div className="result-actions">
              <button className="btn" onClick={createMailbox} disabled={busy || !host.trim() || !mailUser.trim()}>
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
