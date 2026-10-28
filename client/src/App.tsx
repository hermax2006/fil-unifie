import { Feed } from './components/Feed';
import { Connectors } from './components/Connectors';

export function App() {
  return (
    <div className="layout">
      <header>
        <h1>Fil unifié</h1>
      </header>
      <main>
        <section className="feed" aria-label="Fil">
          <Feed />
        </section>
        <aside aria-label="Applications">
          <Connectors />
        </aside>
      </main>
      {/* Widget vocal : voir src/voice/ (à venir) */}
    </div>
  );
}
