import { Feed } from './components/Feed';
import { Connectors } from './components/Connectors';
import { Connections } from './components/Connections';
import { useState } from 'react';

export function App() {
  const [tab, setTab] = useState<'feed' | 'connections'>('feed');

  return (
    <div className="layout">
      <header>
        <h1>Fil unifié</h1>
        <nav className="tabs">
          <button className={tab === 'feed' ? 'tab active' : 'tab'} onClick={() => setTab('feed')}>
            Fil
          </button>
          <button className={tab === 'connections' ? 'tab active' : 'tab'} onClick={() => setTab('connections')}>
            Connexions
          </button>
        </nav>
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
            <Connections />
          </section>
        )}
      </main>
      {/* Widget vocal : voir src/voice/ (à venir) */}
    </div>
  );
}
