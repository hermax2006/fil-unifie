import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UnifiedEvent } from '@fil/shared';
import { readJson } from '../api.js';
import { EventCard, EventPanel } from './EventItem.js';
import { notify, permission, request } from '../notifications.js';

/** Vues du fil : Tous / Non lus / À répondre (maquette). */
export type FeedView = 'all' | 'unread' | 'reply';

/** Compteurs remontés à la sidebar (Tout, Non lus, À répondre, badges par app). */
export type FeedCounts = { total: number; unread: number; byConnector: Record<string, number> };

const PAGE_SIZE = 50;
const ARCHIVED_KEY = 'archived-ids';

function loadArchived(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ARCHIVED_KEY) ?? '[]');
    return Array.isArray(raw) ? new Set(raw.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/** Groupe de date affiché au-dessus des cartes : AUJOURD'HUI / HIER / date. */
function dayGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export function Feed({ view, onViewChange, appFilter, onAppChange, selectedId, onSelect, onCounts, headerExtra }: {
  view: FeedView;
  onViewChange: (v: FeedView) => void;
  /** Filtre par app contrôlé de l'extérieur (sidebar / menu radial). '' = toutes. */
  appFilter: string;
  onAppChange: (c: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Compteurs pour la sidebar (Tout / Non lus / À répondre / badges). */
  onCounts: (c: FeedCounts) => void;
  /** Éléments du topbar ajoutés par App (menu avatar mobile). */
  headerExtra?: ReactNode;
}) {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [archived, setArchived] = useState<Set<string>>(() => loadArchived());
  const [notifState, setNotifState] = useState<string>(() => permission());
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [byConnector, setByConnector] = useState<Record<string, number>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // « À répondre » : pour l'instant, seuls les mails (imap) peuvent être répondus.
  const replyable = (e: UnifiedEvent) => e.connector === 'imap';

  const matches = useCallback((e: UnifiedEvent) => {
    if (appFilter && e.connector !== appFilter) return false;
    if (view === 'unread' && e.readAt) return false;
    if (view === 'reply' && (e.readAt || !replyable(e))) return false;
    if (archived.has(e.id)) return false;
    if (search) {
      const hay = [e.title, e.body, e.author?.name, e.connector]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }, [appFilter, view, search, archived]);

  const buildQs = useCallback((before?: string) => {
    const qs = new URLSearchParams();
    if (appFilter) qs.set('connector', appFilter);
    // « À répondre » : on prend les non-lus, le filtre client affine.
    if (view !== 'all') qs.set('read', 'unread');
    if (search) qs.set('q', search);
    if (before) qs.set('before', before);
    qs.set('limit', String(PAGE_SIZE));
    return qs;
  }, [appFilter, view, search]);

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
    // events n'est utilisé que pour le curseur « before » du chargement suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildQs, events]);

  async function loadCounts() {
    try {
      const res = await fetch('/api/events/unread-count?group=connector', { credentials: 'include' });
      if (!res.ok) return;
      const data = await readJson<{ count?: number; total?: number; byConnector?: Record<string, number> }>(res);
      const counts = { total: data.total ?? 0, unread: data.count ?? 0, byConnector: data.byConnector ?? {} };
      setUnread(counts.unread);
      setTotal(counts.total);
      setByConnector(counts.byConnector);
      onCounts(counts);
    } catch {
      // Le compteur n'est pas bloquant.
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appFilter, view, search]);

  useEffect(() => {
    void loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Raccourcis clavier : j/k naviguer, Entrée ouvrir, u marquer lu.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (visible.length === 0) return;
      const idx = selectedId ? visible.findIndex((ev) => ev.id === selectedId) : -1;
      if (e.key === 'j') {
        const next = visible[Math.min(idx + 1, visible.length - 1)];
        if (next) onSelect(next.id);
      } else if (e.key === 'k') {
        const prev = visible[Math.max(idx - 1, 0)];
        if (prev) onSelect(prev.id);
      } else if (e.key === 'u' && selectedId) {
        void markRead(selectedId);
      } else if (e.key === 'Escape' && selectedId) {
        onSelect(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, archived, selectedId, view, appFilter, search]);

  const visible = useMemo(() => events.filter(matches), [events, matches]);

  // Cartes groupées par jour (AUJOURD'HUI / HIER / …)
  const groups = useMemo(() => {
    const map = new Map<string, UnifiedEvent[]>();
    for (const e of visible) {
      const g = dayGroup(e.receivedAt);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(e);
    }
    return Array.from(map.entries());
  }, [visible]);

  const selected = useMemo(
    () => (selectedId ? visible.find((e) => e.id === selectedId) ?? events.find((e) => e.id === selectedId) : undefined),
    [selectedId, visible, events],
  );

  async function markRead(id: string) {
    const res = await fetch(`/api/events/${id}/read`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return;
    setUnread((c) => Math.max(0, c - 1));
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, readAt: e.readAt || new Date().toISOString() } : e)));
    void loadCounts();
  }

  /** Archiver = marquer lu + retiré du fil (côté client, une vraie archive serveur viendra plus tard). */
  async function archive(id: string) {
    await markRead(id);
    setArchived((prev) => {
      const next = new Set(prev).add(id);
      localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...next]));
      return next;
    });
    setEvents((prev) => prev.filter((e) => e.id !== id));
    onSelect(null);
  }

  async function markAllRead() {
    const res = await fetch('/api/events/read-all', { method: 'POST', credentials: 'include' });
    if (!res.ok) return;
    setUnread(0);
    const now = new Date().toISOString();
    setEvents((prev) => prev.map((e) => ({ ...e, readAt: e.readAt || now })));
    void loadCounts();
  }

  return (
    <div className="feed-page">
      <div className="feed-col">
        <header className="topbar">
          <span className="brand-inline">Fil unifié</span>
          <div className="search">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher un message, une personne, une app"
              aria-label="Rechercher dans le fil"
            />
          </div>
          <button className="speak-btn" disabled title="La dictée vocale arrive bientôt">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            Parler
          </button>
          {headerExtra}
        </header>

        <div className="chips" role="tablist" aria-label="Vues du fil">
          <button className={`chip${view === 'all' ? ' active' : ''}`} onClick={() => onViewChange('all')}>Tous</button>
          <button className={`chip${view === 'unread' ? ' active' : ''}`} onClick={() => onViewChange('unread')}>Non lus</button>
          <button className={`chip${view === 'reply' ? ' active' : ''}`} onClick={() => onViewChange('reply')}>À répondre</button>
          {unread > 0 && view !== 'unread' && (
            <button className="btn small" style={{ marginLeft: 'auto' }} onClick={markAllRead}>Tout marquer lu</button>
          )}
          {notifState !== 'granted' && notifState !== 'unsupported' && (
            <button
              className="btn small"
              onClick={async () => setNotifState(await request())}
              title="Recevoir une notification quand un message arrive, même si tu es sur un autre onglet"
            >
              🔔 Notifications
            </button>
          )}
        </div>

        <p className="kb-hint">Raccourcis : <kbd>j</kbd>/<kbd>k</kbd> naviguer · <kbd>Entrée</kbd> ouvrir · <kbd>u</kbd> marquer lu · <kbd>Échap</kbd> fermer</p>

        {error && <p className="error small" style={{ margin: '0 1.25rem' }}>{error}</p>}

        <div className="feed-scroll">
          {loading ? (
            <p className="empty">Chargement…</p>
          ) : visible.length === 0 ? (
            <p className="empty">
              {total === 0
                ? "Aucun événement pour l'instant. Ajoute une app pour commencer à remplir ton fil."
                : 'Rien dans cette vue. Essaie une autre app ou un autre filtre.'}
            </p>
          ) : (
            groups.map(([label, list]) => (
              <section key={label} aria-label={label}>
                <h3 className="day-group">{label}</h3>
                <ul className="feed-list">
                  {list.map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      selected={selectedId === e.id}
                      onSelect={(id) => onSelect(selectedId === id ? null : id)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          {hasMore && !loading && (
            <button className="btn load-more" onClick={() => void load(false)} disabled={loadingMore}>
              {loadingMore ? 'Chargement…' : 'Charger plus'}
            </button>
          )}
        </div>
      </div>

      {/* Panneau détail : 3e colonne (desktop) / plein écran (mobile, via CSS) */}
      {selected && (
        <EventPanel
          event={selected}
          onMarkRead={(id) => void markRead(id)}
          onArchive={(id) => void archive(id)}
          onReplySent={() => void loadCounts()}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  );
}
