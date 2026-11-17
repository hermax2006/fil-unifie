import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UnifiedEvent } from '@fil/shared';
import { readJson } from '../api.js';
import { EventItem } from './EventItem.js';
import { notify, permission, request } from '../notifications.js';
import { NotificationsToggle } from './ThemeToggle.js';

/** Filtres persistés : l'utilisateur retrouve son filtel au retour. */
type Filters = { connector: string; kind: string; read: 'all' | 'read' | 'unread' };
const FILTERS_KEY = 'feed-filters';

function loadFilters(): Filters {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}');
    return {
      connector: typeof raw.connector === 'string' ? raw.connector : '',
      kind: typeof raw.kind === 'string' ? raw.kind : '',
      read: raw.read === 'read' || raw.read === 'unread' ? raw.read : 'all',
    };
  } catch {
    return { connector: '', kind: '', read: 'all' };
  }
}

const PAGE_SIZE = 50;

export function Feed({ connector: connectorProp, onConnectorChange }: {
  /** Filtre par connecteur contrôlé de l'extérieur (menu radial). */
  connector?: string;
  onConnectorChange?: (c: string) => void;
} = {}) {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [internalConnector, setInternalConnector] = useState(() => loadFilters().connector);
  // Contrôlé de l'extérieur (menu radial) si fourni, sinon l'état interne (persisté).
  const connector = connectorProp !== undefined ? connectorProp : internalConnector;
  const [kind, setKind] = useState(() => loadFilters().kind);
  const [read, setRead] = useState<'all' | 'read' | 'unread'>(() => loadFilters().read);
  const [notifState, setNotifState] = useState<string>(() => permission());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailSignal, setDetailSignal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mémorise les filtres d'un chargement à l'autre.
  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ connector, kind, read }));
  }, [connector, kind, read]);

  const setConnector = (c: string) => {
    setInternalConnector(c);
    onConnectorChange?.(c);
  };

  // Quand l'utilisateur change le filtre dans le select, on le reflète au menu radial.
  useEffect(() => {
    if (connectorProp !== undefined) {
      // Le select interne ne fait que déléguer : on met à jour la source contrôlée.
      if (internalConnector !== connectorProp) onConnectorChange?.(internalConnector);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalConnector]);

  // Raccourcis clavier : j/k naviguer, Entrée ouvrir, u marquer lu.
  // On ignore les touches pendant la saisie dans un champ.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (events.length === 0) return;
      const idx = selectedId ? events.findIndex((ev) => ev.id === selectedId) : -1;
      if (e.key === 'j') {
        const next = events[Math.min(idx + 1, events.length - 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'k') {
        const prev = events[Math.max(idx - 1, 0)];
        if (prev) setSelectedId(prev.id);
      } else if (e.key === 'Enter' && selectedId) {
        setDetailSignal((c) => c + 1);
      } else if (e.key === 'u' && selectedId) {
        void markRead(selectedId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, selectedId]);

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
        if (!e.readAt) {
          setUnread((c) => c + 1);
          notify(
            `Nouveau message — ${e.connector}`,
            e.title || (e.body || '').slice(0, 120) || 'Nouveau contenu',
          );
        }
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
        {notifState !== 'granted' && notifState !== 'unsupported' && (
          <button
            className="btn small"
            onClick={async () => setNotifState(await request())}
            title="Recevoir une notification quand un message arrive, même si tu es sur un autre onglet"
          >
            🔔 Activer les notifications
          </button>
        )}
        <NotificationsToggle />
        {unread > 0 && <span className="unread-badge">{unread} non lu{unread > 1 ? 's' : ''}</span>}
        {unread > 0 && <button className="btn small" onClick={markAllRead}>Tout marquer lu</button>}
      </div>

      <p className="hint kb-hint">Raccourcis : <kbd>j</kbd>/<kbd>k</kbd> naviguer · <kbd>Entrée</kbd> ouvrir · <kbd>u</kbd> marquer lu</p>

      {error && <p className="error small">{error}</p>}

      {loading ? (
        <p className="empty">Chargement…</p>
      ) : events.length === 0 ? (
        <p className="empty">Aucun événement pour l'instant. Ajoute une connexion dans l'onglet « Connexions » pour commencer.</p>
      ) : (
        <ul className="feed-list">
          {events.map((e) => (
            <EventItem
              key={e.id}
              event={e}
              onMarkRead={markRead}
              selected={selectedId === e.id}
              openSignal={selectedId === e.id ? detailSignal : 0}
            />
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
