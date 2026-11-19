import { Feed, type FeedCounts, type FeedView } from './components/Feed';
import { AppCatalog } from './components/AppCatalog';
import { Connections } from './components/Connections';
import { AuthPanel } from './components/AuthPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { Onboarding } from './components/Onboarding';
import { RadialMenu } from './components/RadialMenu';
import { appLabel, REPLYABLE } from './components/EventItem.js';
import { useEffect, useRef, useState } from 'react';
import { readJson } from './api.js';

type User = { id: string; email: string; accountId?: string } | null;

type Tab = 'feed' | 'catalog' | 'settings';
const EMPTY_COUNTS: FeedCounts = { total: 0, unread: 0, byConnector: {} };

export function App() {
  const [tab, setTab] = useState<Tab>('feed');
  const [user, setUser] = useState<User>(null);
  const [onboarding, setOnboarding] = useState<'loading' | 'show' | 'hide'>('loading');

  // Vues du fil + filtre par app (sidebar / menu radial) + sélection (panneau détail).
  const [view, setView] = useState<FeedView>('all');
  const [appFilter, setAppFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<FeedCounts>(EMPTY_COUNTS);

  // Apps connectées (sidebar APPS, catalogue, menu radial).
  const [userConnectors, setUserConnectors] = useState<string[]>([]);

  // Menu avatar (mobile).
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  async function refreshUser() {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
      if (!res.ok) return setUser(null);
      const data = await readJson(res);
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    refreshUser();
  }, []);

  // Apps connectées : rechargées à chaque retour sur un onglet pour rester à jour.
  useEffect(() => {
    if (!user?.accountId) return setUserConnectors([]);
    fetch(`/api/connections/connector-connections?accountId=${user.accountId}`, { credentials: 'include' })
      .then((res) => (res.ok ? readJson<any[]>(res) : []))
      .then((list) => {
        if (!Array.isArray(list)) return [];
        const ids = Array.from(new Set(list.map((c) => c.connectorId as string)));
        setUserConnectors((prev) => (prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids));
      })
      .catch(() => {});
  }, [user, tab]);

  // Onboarding : montré une fois, tant qu'aucune connexion n'existe.
  useEffect(() => {
    if (!user?.accountId) return setOnboarding('loading');
    if (localStorage.getItem(`onboarding-dismissed-${user.email}`)) return setOnboarding('hide');
    fetch(`/api/connections/connector-connections?accountId=${user.accountId}`, { credentials: 'include' })
      .then((res) => (res.ok ? readJson<any[]>(res) : []))
      .then((list) => setOnboarding(Array.isArray(list) && list.length === 0 ? 'show' : 'hide'))
      .catch(() => setOnboarding('hide'));
  }, [user]);

  // Ferme le menu avatar au clic dehors ou à la touche Échap.
  useEffect(() => {
    if (!avatarOpen) return;
    const onDown = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAvatarOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [avatarOpen]);

  const apps = Array.from(new Set(userConnectors));
  const unreadReply = Object.entries(counts.byConnector)
    .filter(([connector]) => REPLYABLE.has(connector))
    .reduce((n, [, c]) => n + c, 0);
  const initial = user?.email?.charAt(0).toUpperCase() ?? '?';

  /** Brancher depuis le catalogue : Mail → onboarding ; les autres → réglages. */
  function connectApp(app: { id: string; connector: string }) {
    if (app.connector === 'imap') {
      setOnboarding('show');
      return;
    }
    setTab('settings');
  }

  const goFeed = (nextView?: FeedView, connector?: string) => {
    if (nextView) setView(nextView);
    if (connector !== undefined) setAppFilter(connector);
    setTab('feed');
    setSelectedId(null);
  };

  const sidebarNav = (
    <nav className="sidebar-nav" aria-label="Vues du fil">
      <button
        className={`nav-item${tab === 'feed' && view === 'all' && !appFilter ? ' active' : ''}`}
        onClick={() => goFeed('all', '')}
      >
        Tout <span className="nav-count">{counts.total}</span>
      </button>
      <button
        className={`nav-item${tab === 'feed' && view === 'unread' ? ' active' : ''}`}
        onClick={() => goFeed('unread', '')}
      >
        Non lus <span className="nav-count">{counts.unread}</span>
      </button>
      <button
        className={`nav-item${tab === 'feed' && view === 'reply' ? ' active' : ''}`}
        onClick={() => goFeed('reply', '')}
      >
        À répondre <span className="nav-count">{unreadReply}</span>
      </button>
    </nav>
  );

  return (
    <div className="app-shell">
      {/* Sidebar (desktop) : vues + apps connectées avec leurs non-lus */}
      <nav className="sidebar" aria-label="Navigation principale">
        <h1 className="brand">
          <button
            style={{ all: 'unset', cursor: 'pointer', fontWeight: 700, color: 'inherit' }}
            onClick={() => goFeed('all', '')}
          >
            Fil unifié
          </button>
        </h1>

        {sidebarNav}

        <div className="sidebar-section">Apps</div>
        <div className="sidebar-apps">
          {apps.map((c) => (
            <button
              key={c}
              className={`app-row${tab === 'feed' && appFilter === c ? ' active' : ''}`}
              onClick={() => goFeed('all', appFilter === c ? '' : c)}
              title={`Filtrer le fil sur ${appLabel(c)}`}
            >
              {appLabel(c)}
              {(counts.byConnector[c] ?? 0) > 0 && <span className="nav-count">{counts.byConnector[c]}</span>}
            </button>
          ))}
          <button className="sidebar-add" onClick={() => setTab('catalog')}>+ Ajouter une app</button>
        </div>

        <div className="sidebar-footer">
          <AuthPanel user={user} onChange={refreshUser} />
          <button className="theme-toggle" onClick={() => setTab('settings')}>⚙️ Réglages</button>
          <ThemeToggle />
        </div>
      </nav>

      {/* Contenu */}
      <main style={{ minWidth: 0 }}>
        {tab === 'feed' && (
          <Feed
            view={view}
            onViewChange={setView}
            appFilter={appFilter}
            onAppChange={setAppFilter}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCounts={setCounts}
            headerExtra={
              /* Menu avatar : sert de navigation sur mobile (sidebar cachée). */
              <div className="avatar-menu-wrap" ref={avatarRef}>
                <button className="icon-btn avatar-btn" onClick={() => setAvatarOpen((o) => !o)} aria-label="Menu du compte" aria-expanded={avatarOpen}>
                  {initial}
                </button>
                {avatarOpen && (
                  <div className="avatar-menu">
                    {user && <span className="user-chip" style={{ margin: '0.3rem' }}>{user.email}</span>}
                    <button onClick={() => { setTab('catalog'); setAvatarOpen(false); }}>Ajouter une app</button>
                    <button onClick={() => { setTab('settings'); setAvatarOpen(false); }}>Réglages</button>
                    <ThemeToggle />
                  </div>
                )}
              </div>
            }
          />
        )}
        {tab === 'catalog' && (
          <AppCatalog
            connectedConnectors={userConnectors}
            onConnect={connectApp}
            onManage={() => setTab('settings')}
            onContinue={() => goFeed('all', '')}
          />
        )}
        {tab === 'settings' && (
          <section className="content" aria-label="Réglages des connexions">
            <Connections user={user} />
          </section>
        )}
      </main>

      {/* Menu radial (mobile) : filtrer le fil par app */}
      <RadialMenu
        apps={apps.map((c) => ({ id: c, name: appLabel(c), unread: counts.byConnector[c] ?? 0 }))}
        activeId={appFilter || null}
        onSelect={(id) => goFeed('all', id ?? '')}
        onAdd={() => setTab('catalog')}
      />

      {/* Assistant de première connexion */}
      {onboarding === 'show' && user && (
        <Onboarding
          user={user}
          onClose={() => setOnboarding('hide')}
          onFinish={() => {
            setTab('feed');
            setOnboarding('hide');
            refreshUser();
          }}
        />
      )}
    </div>
  );
}
