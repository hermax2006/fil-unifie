import { Feed } from './components/Feed';
import { Connectors } from './components/Connectors';
import { Connections } from './components/Connections';
import { AuthPanel } from './components/AuthPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { Onboarding } from './components/Onboarding';
import { RadialMenu } from './components/RadialMenu';
import { useEffect, useState } from 'react';
import { readJson } from './api.js';

type User = { id: string; email: string; accountId?: string } | null;

/** Noms lisibles des connecteurs dans le menu radial. */
const APP_NAMES: Record<string, string> = {
  imap: 'Mail',
  rss: 'RSS',
  telegram: 'Telegram',
  slack: 'Slack',
  webhook: 'Webhook',
  generic: 'Webhook',
};

export function App() {
  const [tab, setTab] = useState<'feed' | 'apps' | 'connections'>('feed');
  const [user, setUser] = useState<User>(null);
  const [onboarding, setOnboarding] = useState<'loading' | 'show' | 'hide'>('loading');

  // Menu radial (mobile) : filtre du fil par app + badges de non-lus.
  const [userConnectors, setUserConnectors] = useState<string[]>([]);
  const [unreadByConnector, setUnreadByConnector] = useState<Record<string, number>>({});
  const [radialFilter, setRadialFilter] = useState<string | null>(null);

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

  // Après connexion : connexions (liste d'apps) + non-lus par connecteur.
  // Rechargé aussi à chaque retour sur le Fil pour des badges à jour.
  useEffect(() => {
    if (!user?.accountId) {
      setUserConnectors([]);
      setUnreadByConnector({});
      return;
    }
    fetch(`/api/connections/connector-connections?accountId=${user.accountId}`, { credentials: 'include' })
      .then((res) => (res.ok ? readJson<any[]>(res) : []))
      .then((list) => {
        if (!Array.isArray(list)) return [];
        setUserConnectors((prev) => {
          const ids = list.map((c) => c.connectorId);
          return prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids;
        });
        return list;
      })
      .catch(() => {});
    fetch('/api/events/unread-count?group=connector', { credentials: 'include' })
      .then((res) => (res.ok ? readJson<{ byConnector?: Record<string, number> }>(res) : null))
      .then((data) => setUnreadByConnector(data?.byConnector ?? {}))
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

  const radialApps = Array.from(new Set(userConnectors)).map((c) => ({
    id: c,
    name: APP_NAMES[c] ?? c,
    unread: unreadByConnector[c] ?? 0,
  }));

  return (
    <div className="layout">
      {/* Navigation latérale (barre basse sur mobile) */}
      <nav className="sidebar" aria-label="Navigation principale">
        <h1 className="brand">Fil unifié</h1>

        <div className="sidebar-nav">
          <button className={tab === 'feed' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('feed')}>
            Fil
          </button>
          <button className={tab === 'apps' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('apps')}>
            Applications
          </button>
          <button className={tab === 'connections' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('connections')}>
            Connexions
          </button>
        </div>

        <div className="sidebar-footer">
          <AuthPanel user={user} onChange={refreshUser} />
          <ThemeToggle />
        </div>
      </nav>

      {/* Contenu de l'onglet actif */}
      <main className="content">
        {tab === 'feed' && (
          <section className="feed-wrap" aria-label="Fil">
            <Feed connector={radialFilter ?? ''} onConnectorChange={setRadialFilter} />
          </section>
        )}
        {tab === 'apps' && (
          <section aria-label="Applications disponibles">
            <Connectors />
          </section>
        )}
        {tab === 'connections' && (
          <section aria-label="Gestion des connexions">
            <Connections user={user} />
          </section>
        )}
      </main>

      {/* Menu radial (mobile uniquement, via CSS) : filtrer le fil par app */}
      <RadialMenu
        apps={radialApps}
        activeId={radialFilter}
        onSelect={(id) => {
          setRadialFilter(id);
          setTab('feed');
        }}
        onAdd={() => setTab('connections')}
      />

      {/* Assistant de première connexion */}
      {onboarding === 'show' && user && (
        <Onboarding
          user={user}
          onClose={() => setOnboarding('hide')}
          onFinish={(nextTab) => {
            setTab(nextTab);
            setOnboarding('hide');
          }}
        />
      )}
      {/* Widget vocal : voir src/voice/ (à venir) */}
    </div>
  );
}
