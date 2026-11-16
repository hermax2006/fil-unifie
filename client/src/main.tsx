import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// PWA : on enregistre le service worker seulement en build de production
// (en dev il gênerait le HMR de Vite).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sans SW, l'app marche quand même : juste pas installable.
    });
  });
}
