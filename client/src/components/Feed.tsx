import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UnifiedEvent } from '@fil/shared';
import { readJson } from '../api.js';

const PAGE_SIZE = 50;

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

export function Feed() {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [connector, setConnector] = useState('');
  const [kind, setKind] = useState('');
  const [read, setRead] = useState<'all' | 'read' | 'unread'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyStatus, setReplyStatus] = useState<Record<string, string>>({});

  const buildQs = useCallback((before?: string) => {
    const qs = new URLSearchParams();
    if (connector) qs.set('connector', connector);
    if (kind) qs.set('kind', kind);
    if (read !== 'all') qs.set('read', read);
    if (search) qs.set('q', search);
    if (before) qs.set('before', before);
    qs.set('limit', String(PAGE_SIZE));
    return qs;
  }, [connector, kind, read, search]);

  const matches = useCallback((e: UnifiedEvent) => {
    if (connector && e.connector !== connector) return false;
    if (kind && e.kind !== kind) return false;
    if (read === 'read' && !e.readAt) return false;
    if (read === 'unread' && e.readAt) return false;
    if (search) {
      const hay = [e.title, e.body, e.author?.name, e.connector]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }, [connector, kind, read, search]);

  const load = useCallback(async (reset = true) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const before = reset ? undefined : events[events.length - 1]?.receivedAt;
      const res = await fetch(`/api/events?${buildQs(before).toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = (await readJson<UnifiedEvent[]>(res)) ?? [];
      setEvents((prev) => {
        if (reset) return data;
        const known = new Set(prev.map((e) => e.id));
        return [...prev, ...data.filter((e) => !known.has(e.id))];
      });
      setHasMore(data.length === PAGE_SIZE);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
    // events n'est utilisé que pour le curseur "before" du chargement suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildQs, events]);

  async function loadUnread() {
    try {
      const res = await fetch('/api/events/unread-count', { credentials: 'include' });
      if (res.ok) setUnread(((await readJson<{ count?: number }>(res)).count) ?? 0);
    } catch {
      // Le compteur n'est pas bloquant.
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector, kind, read, search]);

  useEffect(() => {
    void loadUnread();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as UnifiedEvent;
        if (!e.readAt) setUnread((c) => c + 1);
        setEvents((prev) => {
          if (prev.some((p) => p.id === e.id) || !matches(e)) return prev;
          return [e, ...prev];
        });
      } catch {}
    };
    return () => es.close();
  }, [matches]);

  const connectors = useMemo(() => {
    const list = Array.from(new Set(events.map((e) => e.connector)));
    if (connector && !list.includes(connector)) list.push(connector);
    return list.sort();
  }, [events, connector]);

  async function markRead(id: string) {
    const res = await fetch(`/api/events/${id}/read`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return;
    setUnread((c) => Math.max(0, c - 1));
    if (read === 'unread') {
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } else {
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, readAt: e.readAt || new Date().toISOString() } : e)));
    }
  }

  async function markAllRead() {
    const res = await fetch('/api/events/read-all', { method: 'POST', credentials: 'include' });
    if (!res.ok) return;
    setUnread(0);
    if (read === 'unread') {
      setEvents([]);
      setHasMore(false);
    } else {
      const now = new Date().toISOString();
      setEvents((prev) => prev.map((e) => ({ ...e, readAt: e.readAt || now })));
    }
  }

  function startReply(e: UnifiedEvent) {
    setReplyToId(e.id);
    setReplySubject(e.title ? (/^re\s*:/i.test(e.title) ? e.title : `Re: ${e.title}`) : 'Re: (sans objet)');
    setReplyTo(e.author?.id ?? '');
    setReplyBody('');
    setReplyStatus((prev) => ({ ...prev, [e.id]: '' }));
  }

  function cancelReply() {
    setReplyToId(null);
    setReplyBody('');
  }

  async function sendReply(e: UnifiedEvent) {
    setReplySending(true);
    try {
      const res = await fetch(`/api/events/${e.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          body: replyBody,
          subject: replySubject.trim() || undefined,
          to: replyTo.trim() || undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setReplyStatus((prev) => ({ ...prev, [e.id]: 'OK : réponse envoyée' }));
      setReplyToId(null);
      setReplyBody('');
    } catch (err: any) {
      setReplyStatus((prev) => ({ ...prev, [e.id]: `Erreur : ${err.message}` }));
    } finally {
      setReplySending(false);
    }
  }

  return (
    <div className="feed-wrap">
      <div className="filters">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Rechercher (titre, contenu, auteur)…"
          aria-label="Rechercher dans le fil"
        />
        <select value={connector} onChange={(e) => setConnector(e.target.value)}>
          <option value="">Tous connecteurs</option>
          {connectors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tous types</option>
          <option value="message">message</option>
          <option value="mention">mention</option>
          <option value="notification">notification</option>
          <option value="task">task</option>
          <option value="other">other</option>
        </select>
        <select value={read} onChange={(e) => setRead(e.target.value as any)}>
          <option value="all">Tous</option>
          <option value="unread">Non lus</option>
          <option value="read">Lus</option>
        </select>
        <button className="btn small" onClick={() => void load(true)} disabled={loading}>Actualiser</button>
        {unread > 0 && <span className="unread-badge">{unread} non lu{unread > 1 ? 's' : ''}</span>}
        {unread > 0 && <button className="btn small" onClick={markAllRead}>Tout marquer lu</button>}
      </div>

      {error && <p className="error small">{error}</p>}

      {loading ? (
        <p className="empty">Chargement…</p>
      ) : events.length === 0 ? (
        <p className="empty">Aucun événement pour l'instant.</p>
      ) : (
        <ul className="feed-list">
          {events.map((e) => (
            <li key={e.id} className={`event ${e.readAt ? 'read' : 'unread'}`}>
              <div className="event-header">
                <span className="event-connector">{e.connector}</span>
                <span className="event-time">{timeAgo(e.receivedAt)}</span>
              </div>
              {e.title && <div className="event-title">{e.title}</div>}
              <div className="event-body">{e.body}</div>
              {e.attachments && e.attachments.length > 0 && (
                <div className="event-attachments">
                  <span className="attachment-label">Pièces jointes :</span>
                  {e.attachments.map((a, i) => (
                    <span className="attachment" key={`${a.filename}-${i}`}>
                      {a.filename}
                      {a.size ? ` (${Math.max(1, Math.round(a.size / 1024))} Ko)` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div className="event-footer">
                {e.author?.name && <span className="event-author">— {e.author.name}</span>}
                {e.url && <a className="event-link" href={e.url} target="_blank" rel="noreferrer">Ouvrir</a>}
                {e.connector === 'imap' && replyToId !== e.id && (
                  <button className="btn small" onClick={() => startReply(e)}>Répondre</button>
                )}
                {!e.readAt && <button className="btn small" onClick={() => markRead(e.id)}>Marquer lu</button>}
                {replyStatus[e.id] && (
                  <span className={replyStatus[e.id].startsWith('OK') ? 'success small' : 'error small'}>
                    {replyStatus[e.id]}
                  </span>
                )}
              </div>
              {e.connector === 'imap' && replyToId === e.id && (
                <div className="reply-form">
                  <label>
                    À
                    <input value={replyTo} onChange={(ev) => setReplyTo(ev.target.value)} placeholder="destinataire@example.com" />
                  </label>
                  <label>
                    Objet
                    <input value={replySubject} onChange={(ev) => setReplySubject(ev.target.value)} />
                  </label>
                  <label>
                    Réponse
                    <textarea value={replyBody} onChange={(ev) => setReplyBody(ev.target.value)} rows={4} placeholder="Votre réponse…" />
                  </label>
                  <div className="result-actions">
                    <button className="btn small" onClick={() => sendReply(e)} disabled={replySending || !replyBody.trim()}>
                      {replySending ? 'Envoi…' : 'Envoyer'}
                    </button>
                    <button className="btn small" onClick={cancelReply} disabled={replySending}>Annuler</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <button className="btn load-more" onClick={() => void load(false)} disabled={loadingMore}>
          {loadingMore ? 'Chargement…' : 'Charger plus'}
        </button>
      )}
    </div>
  );
}
