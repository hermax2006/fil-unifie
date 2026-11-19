import { useEffect, useMemo, useState } from 'react';
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

/** Connecteurs capables d'envoyer une réponse depuis le fil. */
export const REPLYABLE = new Set(['imap', 'telegram']);

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

/* ---------- Corps du message lisible (paragraphes, liens, citation repliée) ---------- */

const QUOTE_START = /^(?:>|Le\s.+\sa\sécrit\s*:|On\s.+\swrote\s*:|-----+\s*Message d'origine|-----+\s*Original Message|De\s*:\s|From\s*:\s|Envoyé\s*:\s|Sent\s*:\s)/i;
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Coupe la partie citée d'un email (historique) du message principal. */
function splitQuoted(text: string): { main: string; quote: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let cut = -1;
  let quotedLines = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>/.test(lines[i])) {
      quotedLines++;
      if (quotedLines >= 2) { cut = i - quotedLines + 1; break; }
    } else if (QUOTE_START.test(lines[i].trim())) {
      cut = i; break;
    }
  }
  if (cut < 0) return { main: text, quote: '' };
  const main = lines.slice(0, cut).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const quote = lines.slice(cut).join('\n').trim();
  // Un « message cité » collé au début sans vrai contenu avant : on ne coupe pas.
  if (main.length < 40) return { main: text, quote: '' };
  return { main, quote };
}

/** Découpe en paragraphes en recollant les lignes coupées à la dure (mail 72 colonnes). */
function toParagraphs(text: string): string[] {
  const blocks = text.split(/\n\s*\n/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let current = '';
    const flush = () => { if (current.trim()) out.push(current.trim()); current = ''; };
    for (const line of lines) {
      const t = line.trimEnd();
      const keepAlone = /^\s*(?:[-•*–]|\d+[.)])\s/.test(t) || /^\s*(?:--|__)\s*$/.test(t);
      if (!t.trim()) { flush(); continue; }
      if (keepAlone) { flush(); out.push(t.trim()); continue; }
      // Ligne précédente longue = retour à la ligne automatique : on recolle.
      if (current && current.length > 60) current += ' ' + t.trim();
      else if (current) { flush(); current = t; }
      else current = t;
    }
    flush();
  }
  return out;
}

/** Texte avec URLs cliquables (libellé raccourci pour ne pas casser la mise en page). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        let label = part;
        try {
          const u = new URL(part);
          label = `${u.hostname}${u.pathname === '/' ? '' : u.pathname.slice(0, 28)}${part.length > 56 ? '…' : ''}`;
        } catch { label = part.slice(0, 56) + '…'; }
        return (
          <a key={i} className="msg-link" href={part} target="_blank" rel="noreferrer" title={part}>{label}</a>
        );
      })}
    </>
  );
}

const PREVIEW_CHARS = 900;

export function MessageBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const { paragraphs, previewCount, quote, truncated } = useMemo(() => {
    const { main, quote: q } = splitQuoted(text);
    const all = toParagraphs(main);
    // Aperçu : les premiers paragraphes (~900 caractères), le reste sur demande.
    let used = 0;
    let count = 0;
    for (const p of all) {
      if (used > PREVIEW_CHARS) break;
      used += p.length;
      count++;
    }
    return {
      paragraphs: all,
      previewCount: Math.max(1, count),
      quote: q ? toParagraphs(q.replace(/^\s*>\s?/gm, '')) : [],
      truncated: all.length > Math.max(1, count),
    };
  }, [text]);

  const shown = expanded ? paragraphs : paragraphs.slice(0, previewCount);
  const isBullet = (p: string) => /^\s*(?:[-•*–]|\d+[.)])\s/.test(p);

  return (
    <div className="msg-body">
      {shown.map((p, i) => (
        <p key={i} className={isBullet(p) ? 'msg-bullet' : undefined}>
          {isBullet(p) ? p : <Linkified text={p} />}
        </p>
      ))}
      {truncated && (
        <button className="btn small msg-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Réduire le message' : 'Afficher tout le message'}
        </button>
      )}
      {quote.length > 0 && (
        <details className="msg-quote">
          <summary>Message cité ({quote.length} bloc{quote.length > 1 ? 's' : ''})</summary>
          {quote.map((p, i) => (
            <p key={i} className={isBullet(p) ? 'msg-bullet' : undefined}>
              {isBullet(p) ? p : <Linkified text={p} />}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}

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

  const replyable = REPLYABLE.has(event.connector);
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

      <MessageBody text={event.body} />

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
        {showFields && event.connector === 'imap' && (
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
