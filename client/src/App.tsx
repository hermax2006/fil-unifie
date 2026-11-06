import { Feed } from './components/Feed';
import { Connectors } from './components/Connectors';
import { Connections } from './components/Connections';
import { AuthPanel } from './components/AuthPanel';
import { useEffect, useState } from 'react';

type User = { id: string; email: string; accountId?: string } | null;

export function App() {
  const [tab, setTab] = useState<'feed' | 'connections'>('feed');
  const [user, setUser] = useState<User>(null);

  async function refreshUser() {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
      if (!res.ok) return setUser(null);
      const data = await res.json();
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    refreshUser();
  }, []);

  return (
    <div className="layout">
      <header>
        <h1>Fil unifié</h1>
        <div className="header-right">
          <nav className="tabs">
            <button className={tab === 'feed' ? 'tab active' : 'tab'} onClick={() => setTab('feed')}>
              Fil
            </button>
            <button className={tab === 'connections' ? 'tab active' : 'tab'} onClick={() => setTab('connections')}>
              Connexions
            </button>
          </nav>
          <AuthPanel user={user} onChange={refreshUser} />
        </div>
      </header>
      <main>
        {tab === 'feed' && (
          <>
            <section className="feed" aria-label="Fil">
              <Feed />
            </section>
            <aside aria-label="Applications">
              <Connectors />
            </aside>
          </>
        )}
        {tab === 'connections' && (
          <section className="full" aria-label="Gestion des connexions">
            <Connections user={user} />
          </section>
        )}
      </main>
      {/* Widget vocal : voir src/voice/ (à venir) */}
    </div>
  );
}
