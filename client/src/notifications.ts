/**
 * Notifications navigateur (Web Notification API).
 * - permission() : état actuel ('unsupported' si l'API n'existe pas)
 * - request() : demande la permission (à appeler depuis un clic utilisateur)
 * - notify() : n'affiche que si la permission est accordée ET l'onglet caché
 */
export function permission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function request(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

/** Affiche une notification seulement si l'utilisateur est ailleurs (onglet en arrière-plan). */
export function notify(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // l'utilisateur regarde déjà l'app : inutile de crier
  try {
    const n = new Notification(title, { body, tag: 'fil-unifie' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Notification API capricieuse (navigateurs mobiles) : on ignore silencieusement.
  }
}
