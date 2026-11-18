import { useEffect, useState } from 'react';
import { permission, request } from '../notifications.js';

/**
 * Thème clair par défaut (maquette), sombre optionnel.
 * On pose data-theme sur <html> pour que toutes les variables CSS suivent,
 * et on persiste le choix dans localStorage.
 */
function initialTheme(): 'dark' | 'light' {
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <button
      className="theme-toggle"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Changer de thème"
      title={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
    >
      <span aria-hidden="true">{theme === 'dark' ? '🌙' : '☀️'}</span>
      <span>{theme === 'dark' ? 'Sombre' : 'Clair'}</span>
    </button>
  );
}

/**
 * Bouton d'activation des notifications navigateur.
 * Ne s'affiche que si la permission n'est pas encore décidée (ou refusée).
 */
export function NotificationsToggle() {
  const [state, setState] = useState<string>(() => permission());

  if (state === 'unsupported' || state === 'granted') return null;

  async function enable() {
    const result = await request();
    setState(result);
  }

  return (
    <button className="btn small" onClick={enable} title="Recevoir une notification quand un message arrive, même si tu es sur un autre onglet">
      🔔 Notifications {state === 'denied' ? 'bloquées' : ''}
    </button>
  );
}
