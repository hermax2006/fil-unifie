import { useEffect, useState } from 'react';
import type { UnifiedEvent } from '@fil/shared';
import { readJson } from '../api.js';

/** Nom d'app affiché dans les badges (maquette : Gmail, Slack · #support, Telegram…). */
export const APP_LABEL: Record<string, string> = {
  imap: 'Gmail',
  rss: 'RSS',
  telegram: 'Telegram',
  slack: 'Slack',
  webhook: 'Webhook',
  generic: 'Webhook',
};

export function appLabel(connector: string) {
  return APP_LABEL[connector] ?? connector;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

type OutboundRow = {
  id: string;
  to?: string;
  subject?: string;
  body?: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string | null;
  created_at: string;
  sent_at?: string | null;
};

const STATUS_LABEL: Record<OutboundRow['status'], string> = {
  pending: 'en attente',
  sent: 'envoyé',
  failed: 'échoué',
};

/* ---------- Carte du fil (maquette : point, auteur, badge app, extrait, heure) ---------- */

export function EventCard({ event, selected, onSelect }: {
  event: UnifiedEvent;
  selected?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li
      className={`event${event.readAt ? ' read' : ' unread'}${selected ? ' selected' : ''}`}
      tabIndex={-1}
      ref={(el) => {
        if (selected && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }}
      onClick={() => onSelect(event.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(event.id); }}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="event-header">
        <span className={`dot${event.readAt ? ' read' : ''}`} aria-label={event.readAt ? 'lu' : 'non lu'} />
        <span className="event-author">{event.author?.name ?? 'Alerte'}</span>
        <span className="app-badge">{appLabel(event.connector)}</span>
        <span className="event-time">{fmtTime(event.receivedAt)}</span>
      </div>
      {event.title && <div className="event-title">{event.title}</div>}
      <div className="event-body">{event.body}</div>
    </li>
  );
}

/* ---------- Panneau détail (3e colonne, maquette) ---------- */

export function EventPanel({ event, onMarkRead, onArchive, onReplySent, onClose }: {
  event: UnifiedEvent;
  onMarkRead: (id: string) => void;
  onArchive: (id: string) => void;
  onReplySent: () => void;
  onClose: () => void;
}) {
  const [outbound, setOutbound] = useState<OutboundRow[] | null>(null);
  const [showFields, setShowFields] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setShowFields(false);
    fetch(`/api/events/${event.id}/outbound`, { credentials: 'include' })
      .then((r) => (r.ok ? readJson<OutboundRow[]>(r) : []))
      .then((rows) => { if (!cancelled) setOutbound(rows ?? []); })
      .catch(() => { if (!cancelled) setOutbound([]); });
    return () => { cancelled = true; };
  }, [event.id, onReplySent]);

  const replyable = event.connector === 'imap';
  const app = appLabel(event.connector);

  return (
    <aside className="detail-panel" role="dialog" aria-label="Détail de l'événement">
      <button className="btn small modal-close" onClick={onClose} aria-label="Fermer">✕</button>

      <div className="detail-meta">
        <span className="app-badge">{app}</span>
        <span>{fmtDate(event.occurredAt)}</span>
      </div>

      {event.title && <h2 className="detail-title">{event.title}</h2>}
      {event.author?.name && <div className="detail-author">De {event.author.name}</div>}

      <div className="detail-body">{event.body}</div>

      {event.attachments && event.attachments.length > 0 && (
        <div className="event-attachments">
          <span className="attachment-label">Pièces jointes :</span>
          {event.attachments.map((a, i) => (
            <a
              className="attachment"
              key={`${a.filename}-${i}`}
              href={`/api/events/${event.id}/attachments/${i}`}
              download
            >
              📄 {a.filename}
              {a.size ? ` (${Math.max(1, Math.round(a.size / 1024))} Ko)` : ''}
            </a>
          ))}
        </div>
      )}

      {event.url && (
        <a className="event-link" href={event.url} target="_blank" rel="noreferrer">Ouvrir dans l'app source</a>
      )}

      <div className="detail-actions">
        {!event.readAt && (
          <button className="btn" onClick={() => onMarkRead(event.id)}>Marquer lu</button>
        )}
        <button className="btn" onClick={() => onArchive(event.id)} title="Marquer lu et retirer du fil">Archiver</button>
      </div>

      <div className="outbound">
        <h3>Réponses</h3>
        {outbound === null ? (
          <p className="hint">Chargement…</p>
        ) : outbound.length === 0 ? (
          <p className="hint">Aucune réponse envoyée pour cet événement.</p>
        ) : (
          <ul className="outbound-list">
            {outbound.map((o) => (
              <li key={o.id} className="outbound-item">
                <div className="outbound-head">
                  <span className={`outbound-status ${o.status}`}>{STATUS_LABEL[o.status]}</span>
                  <span className="outbound-date">{fmtDate(o.created_at)}</span>
                </div>
                <div className="outbound-meta">
                  À : {o.to || '(destinataire inconnu)'}
                  {o.subject ? ` — Objet : ${o.subject}` : ''}
                </div>
                {o.error && <div className="error small">{o.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {replyable && (
        <ReplySection event={event} app={app} showFields={showFields} onToggleFields={() => setShowFields((s) => !s)} onSent={onReplySent} />
      )}
    </aside>
  );
}

/* ---------- Zone de réponse (maquette : « Votre réponse » + brouillon suggéré) ---------- */

function ReplySection({ event, app, showFields, onToggleFields, onSent }: {
  event: UnifiedEvent;
  app: string;
  showFields: boolean;
  onToggleFields: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(event.author?.id ?? '');
  const [subject, setSubject] = useState(event.title ? (/^re\s*:/i.test(event.title) ? event.title : `Re: ${event.title}`) : 'Re: (sans objet)');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  async function send() {
    setSending(true);
    setStatus('');
    try {
      const res = await fetch(`/api/events/${event.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body, subject: subject.trim() || undefined, to: to.trim() || undefined }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setStatus('OK : réponse envoyée');
      setBody('');
      onSent();
    } catch (err: any) {
      setStatus(`Erreur : ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="reply-section">
      <div className="reply-label">
        Votre réponse
        <span className="draft-badge" title="L'IA proposera un brouillon ici (à venir)">Brouillon suggéré</span>
      </div>
      <div className="reply-form">
        {showFields && (
          <>
            <label>
              À
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destinataire@example.com" />
            </label>
            <label>
              Objet
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
          </>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={`Ton message… (envoyé via ${app})`}
          aria-label="Votre réponse"
        />
        <div className="reply-actions">
          {status && <span className={status.startsWith('OK') ? 'success small' : 'error small'}>{status}</span>}
          <button className="btn" onClick={onToggleFields}>{showFields ? 'Réduire' : 'Modifier'}</button>
          <button className="btn primary" onClick={send} disabled={sending || !body.trim()}>
            {sending ? 'Envoi…' : `Envoyer par ${app}`}
          </button>
        </div>
      </div>
    </div>
  );
}
