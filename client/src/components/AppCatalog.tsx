import { useMemo, useState } from 'react';

export type CatalogStatus = 'connected' | 'available' | 'soon';

type CatalogApp = {
  id: string;
  name: string;
  category: 'Mail' | 'Messagerie' | 'Agenda' | 'Outils';
  price: 'Gratuit' | 'Payant';
  desc: string;
  /** Connecteur réel derrière cette app ('' si pas encore implémenté). */
  connector: string;
  status: CatalogStatus;
};

/** Catalogue statique, fidèle à la maquette « Choisis les apps à unir ». */
const APPS: CatalogApp[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Mail',
    price: 'Gratuit',
    desc: 'Reçois tes mails dans le fil et réponds sans quitter l’app.',
    connector: 'imap',
    status: 'available',
  },
  {
    id: 'imap',
    name: 'IMAP / SMTP',
    category: 'Mail',
    price: 'Gratuit',
    desc: 'Tout fournisseur de mail : lecture par IMAP, envoi par SMTP.',
    connector: 'imap',
    status: 'available',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Messagerie',
    price: 'Gratuit',
    desc: 'Messages, mentions et canaux suivis, avec réponse depuis le fil.',
    connector: 'slack',
    status: 'available',
  },
  {
    id: 'telegram',
    name: 'Telegram (bot)',
    category: 'Messagerie',
    price: 'Gratuit',
    desc: 'Les messages reçus par ton bot arrivent dans le fil.',
    connector: 'telegram',
    status: 'available',
  },
  {
    id: 'webhook',
    name: 'Webhook générique',
    category: 'Outils',
    price: 'Gratuit',
    desc: 'Toute app capable d’envoyer du JSON peut alimenter le fil.',
    connector: 'webhook',
    status: 'available',
  },
  {
    id: 'gcal',
    name: 'Google Calendar',
    category: 'Agenda',
    price: 'Gratuit',
    desc: 'Rendez-vous et rappels dans le fil.',
    connector: '',
    status: 'soon',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    category: 'Messagerie',
    price: 'Payant',
    desc: 'Messages clients via l’API officielle de Meta.',
    connector: '',
    status: 'soon',
  },
];

const CATEGORIES = ['Toutes', 'Messagerie', 'Mail', 'Agenda', 'Outils'] as const;

const STATUS_LABEL: Record<CatalogStatus, string> = {
  connected: 'Connecté',
  available: 'Disponible',
  soon: 'Bientôt',
};

export function AppCatalog({ connectedConnectors, onConnect, onManage, onContinue }: {
  /** Connecteurs réellement connectés par l'utilisateur (imap, slack…). */
  connectedConnectors: string[];
  /** « Brancher » : lance la connexion (onboarding pour Mail, réglages sinon). */
  onConnect: (app: CatalogApp) => void;
  /** « Gérer » : ouvre les réglages de la connexion. */
  onManage: (app: CatalogApp) => void;
  /** « Continuer vers mon fil ». */
  onContinue: () => void;
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Toutes');
  const [searchInput, setSearchInput] = useState('');
  const [wishes, setWishes] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('app-wishes') ?? '[]');
      return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });

  // Une app est « connectée » si l'un de ses connecteurs est réellement branché.
  const connected = useMemo(
    () => new Set(APPS.filter((a) => a.connector && connectedConnectors.includes(a.connector)).map((a) => a.id)),
    [connectedConnectors],
  );

  const visible = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return APPS.filter((a) => {
      if (category !== 'Toutes' && a.category !== category) return false;
      if (q && !`${a.name} ${a.desc}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [category, searchInput]);

  function wish(app: CatalogApp) {
    setWishes((prev) => {
      const next = new Set(prev).add(app.id);
      localStorage.setItem('app-wishes', JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <div className="catalog">
      <h1>Choisis les apps à unir</h1>
      <p className="catalog-sub">Tu pourras en ajouter ou en retirer à tout moment dans les réglages.</p>

      <div className="search" style={{ maxWidth: 420 }}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Rechercher une app"
          aria-label="Rechercher une app"
        />
      </div>

      <div className="catalog-chips" role="tablist" aria-label="Catégories">
        {CATEGORIES.map((c) => (
          <button key={c} className={`chip${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="catalog-grid">
        {visible.map((app) => {
          const isConnected = connected.has(app.id);
          const status: CatalogStatus = isConnected ? 'connected' : app.status;
          return (
            <article className="app-card" key={app.id}>
              <div className="app-card-head">
                <span className="app-card-name">{app.name}</span>
                <span className={`status-badge ${status}`}>{STATUS_LABEL[status]}</span>
              </div>
              <div className="app-card-meta">{app.category} · {app.price}</div>
              <p className="app-card-desc">{app.desc}</p>
              {status === 'connected' && (
                <button className="btn" onClick={() => onManage(app)}>Gérer</button>
              )}
              {status === 'available' && (
                <button className="btn primary" onClick={() => onConnect(app)}>Brancher</button>
              )}
              {status === 'soon' && (
                <button
                  className="btn"
                  disabled={wishes.has(app.id)}
                  onClick={() => wish(app)}
                  title="On te préviendra quand cette app sera prête"
                >
                  {wishes.has(app.id) ? 'Noté, merci !' : 'Je veux celle-ci'}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <div className="catalog-footer">
        <span className="catalog-count">{connected.size} app{connected.size > 1 ? 's' : ''} connectée{connected.size > 1 ? 's' : ''}</span>
        <button className="btn primary" onClick={onContinue}>Continuer vers mon fil</button>
      </div>
    </div>
  );
}
