import { Feed } from './components/Feed';
import { Connectors } from './components/Connectors';
import { Connections } from './components/Connections';
import { AuthPanel } from './components/AuthPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { Onboarding } from './components/Onboarding';
import { useEffect, useState } from 'react';
import { readJson } from './api.js';

type User = { id: string; email: string; accountId?: string } | null;

export function App() {
  const [tab, setTab] = useState<'feed' | 'apps' | 'connections'>('feed');
  const [user, setUser] = useState<User>(null);
  const [onboarding, setOnboarding] = useState<'loading' | 'show' | 'hide'>('loading');

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

  // Onboarding : montré une fois, tant qu'aucune connexion n'existe.
  useEffect(() => {
    if (!user?.accountId) return setOnboarding('loading');
    if (localStorage.getItem(`onboarding-dismissed-${user.email}`)) return setOnboarding('hide');
    fetch(`/api/connections/connector-connections?accountId=${user.accountId}`, { credentials: 'include' })
      .then((res) => (res.ok ? readJson<any[]>(res) : []))
      .then((list) => setOnboarding(Array.isArray(list) && list.length === 0 ? 'show' : 'hide'))
      .catch(() => setOnboarding('hide'));
  }, [user]);

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
            <Feed />
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
