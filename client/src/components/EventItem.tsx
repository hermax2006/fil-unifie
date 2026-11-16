import { useEffect, useState } from 'react';
import type { UnifiedEvent } from '@fil/shared';
import { readJson } from '../api.js';

/** Icône par connecteur : permet de repérer la source d'un coup d'œil. */
const ICONS: Record<string, string> = {
  imap: '✉️',
  rss: '📰',
  telegram: '✈️',
  slack: '💬',
  generic: '🔗',
};

/** Au-delà de cette taille, le corps est tronqué dans la carte (complet dans la vue détail). */
const TRUNCATE = 320;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
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
  pending: '⏳ en attente',
  sent: '✅ envoyé',
  failed: '❌ échoué',
};

/* ---------- Formulaire de réponse (utilisé dans la carte et la vue détail) ---------- */

function ReplyForm({ event, onSent }: { event: UnifiedEvent; onSent: () => void }) {
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
    <div className="reply-form">
      <label>
        À
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destinataire@example.com" />
      </label>
      <label>
        Objet
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label>
        Réponse
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Votre réponse…" />
      </label>
      <div className="result-actions">
        <button className="btn small" onClick={send} disabled={sending || !body.trim()}>
          {sending ? 'Envoi…' : 'Envoyer'}
        </button>
        {status && <span className={status.startsWith('OK') ? 'success small' : 'error small'}>{status}</span>}
      </div>
    </div>
  );
}

/* ---------- Vue détail (plein écran) ---------- */

function EventDetail({ event, onClose, onReplySent }: { event: UnifiedEvent; onClose: () => void; onReplySent: () => void }) {
  const [outbound, setOutbound] = useState<OutboundRow[] | null>(null);

  useEffect(() => {
    // Historique des réponses de cet événement, chargé à l'ouverture.
    let cancelled = false;
    fetch(`/api/events/${event.id}/outbound`, { credentials: 'include' })
      .then((r) => (r.ok ? readJson<OutboundRow[]>(r) : []))
      .then((rows) => { if (!cancelled) setOutbound(rows ?? []); })
      .catch(() => { if (!cancelled) setOutbound([]); });
    return () => { cancelled = true; };
  }, [event.id, onReplySent]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Détail de l'événement">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close btn small" onClick={onClose} aria-label="Fermer">✕</button>

        <div className="detail-meta">
          <span className="event-connector">{ICONS[event.connector] ?? '•'} {event.connector}</span>
          <span>{fmtDate(event.occurredAt)}</span>
        </div>
        {event.title && <h2 className="detail-title">{event.title}</h2>}
        <div className="detail-body">{event.body}</div>

        {event.attachments && event.attachments.length > 0 && (
          <div className="event-attachments">
            <span className="attachment-label">Pièces jointes :</span>
            {event.attachments.map((a, i) => (
              <span className="attachment" key={`${a.filename}-${i}`}>
                {a.filename}
                {a.size ? ` (${Math.max(1, Math.round(a.size / 1024))} Ko)` : ''}
              </span>
            ))}
          </div>
        )}

        {event.url && (
          <a className="event-link" href={event.url} target="_blank" rel="noreferrer">Ouvrir dans l'app source</a>
        )}

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

        {event.connector === 'imap' && <ReplyForm event={event} onSent={onReplySent} />}
      </div>
    </div>
  );
}

/* ---------- Carte du fil ---------- */

export function EventItem({ event, onMarkRead, selected, openSignal }: {
  event: UnifiedEvent;
  onMarkRead: (id: string) => void;
  /** Card mise en évidence par la navigation clavier (j/k). */
  selected?: boolean;
  /** Un compteur > 0 sur la carte sélectionnée ouvre la vue détail (touche Entrée). */
  openSignal?: number;
}) {
  const [showFull, setShowFull] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyCount, setReplyCount] = useState(0);

  useEffect(() => {
    if (selected && openSignal) setDetailOpen(true);
  }, [openSignal, selected]);

  const long = (event.body?.length ?? 0) > TRUNCATE;
  const body = long && !showFull && !detailOpen ? `${event.body.slice(0, TRUNCATE)}…` : event.body;

  return (
    <li
      className={`event ${event.readAt ? 'read' : 'unread'}${selected ? ' selected' : ''}`}
      tabIndex={-1}
      ref={(el) => {
        // Suit la sélection clavier : on garde la carte choisie visible.
        if (selected && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }}
    >
      <div className="event-header">
        <span className="event-connector">
          {ICONS[event.connector] ?? '•'} {event.connector}
        </span>
        <span className="event-time" title={fmtDate(event.receivedAt)}>{timeAgo(event.receivedAt)}</span>
      </div>

      {event.title && <div className="event-title">{event.title}</div>}
      <div className="event-body">{body}</div>
      {long && !showFull && !detailOpen && (
        <button className="see-more" onClick={() => setShowFull(true)}>Voir plus</button>
      )}

      {event.attachments && event.attachments.length > 0 && (
        <div className="event-attachments">
          <span className="attachment-label">Pièces jointes :</span>
          {event.attachments.map((a, i) => (
            <span className="attachment" key={`${a.filename}-${i}`}>
              {a.filename}
              {a.size ? ` (${Math.max(1, Math.round(a.size / 1024))} Ko)` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="event-footer">
        {event.author?.name && <span className="event-author">— {event.author.name}</span>}
        <button className="btn small" onClick={() => setDetailOpen(true)}>Détails{replyCount > 0 ? ` (${replyCount})` : ''}</button>
        {event.url && (
          <a className="event-link" href={event.url} target="_blank" rel="noreferrer">Ouvrir</a>
        )}
        {event.connector === 'imap' && !replyOpen && (
          <button className="btn small" onClick={() => setReplyOpen(true)}>Répondre</button>
        )}
        {!event.readAt && <button className="btn small" onClick={() => onMarkRead(event.id)}>Marquer lu</button>}
      </div>

      {event.connector === 'imap' && replyOpen && (
        <ReplyForm event={event} onSent={() => { setReplyCount((c) => c + 1); setReplyOpen(false); }} />
      )}

      {detailOpen && (
        <EventDetail event={event} onClose={() => setDetailOpen(false)} onReplySent={() => setReplyCount((c) => c + 1)} />
      )}
    </li>
  );
}
