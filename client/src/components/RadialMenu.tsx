import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { radialPositions } from './geometry';
import './RadialMenu.css';

export interface RadialApp {
  id: string;
  name: string;
  unread?: number;
}

interface Props {
  apps: RadialApp[];
  /** App actuellement utilisée comme filtre du fil (null = toutes). */
  activeId?: string | null;
  /** Appelé avec l'id de l'app, ou null si on touche l'app déjà active (retire le filtre). */
  onSelect: (id: string | null) => void;
  onAdd: () => void;
}

/**
 * Menu circulaire pour mobile : un bouton rond, qui déploie les apps en arc autour de lui.
 * Caché automatiquement sur grand écran (voir le CSS) : sur PC, garde ta barre latérale.
 */
export function RadialMenu({ apps, activeId = null, onSelect, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 390 : window.innerWidth));
  const mainRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const items = [...apps.map((a) => ({ ...a, add: false })), { id: '__add', name: 'Ajouter', unread: 0, add: true }];
  const totalUnread = apps.reduce((n, a) => n + (a.unread ?? 0), 0);
  const { radius, points } = radialPositions(items.length, vw);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) mainRef.current?.focus();
  }, []);

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <div className="radial" data-open={open || undefined}>
      {open && <div className="radial__scrim" aria-hidden="true" onClick={() => close(false)} />}

      <div className="radial__anchor" role="group" aria-label="Filtrer le fil par app">
        <svg className="radial__arc" aria-hidden="true" width="1" height="1" style={{ overflow: 'visible' }}>
          <path d={`M ${-radius} 0 A ${radius} ${radius} 0 0 1 ${radius} 0`} fill="none" />
        </svg>
        {open && <p className="radial__caption" style={{ top: -radius - 80 }}>Filtrer le fil par app</p>}

        {items.map((it, i) => {
          const p = points[i];
          const style = { '--x': `${p.x}px`, '--y': `${p.y}px`, transitionDelay: open ? `${i * 30}ms` : '0ms' } as CSSProperties;
          const active = !it.add && it.id === activeId;
          const label = it.add ? 'Ajouter une app' : `${it.name}${it.unread ? `, ${it.unread} non lus` : ''}${active ? ', filtre actif' : ''}`;
          return (
            <div className="radial__slot" style={style} key={it.id}>
              <button
                ref={i === 0 ? firstItemRef : undefined}
                type="button"
                className={`radial__item${it.add ? ' radial__item--add' : ''}${active ? ' radial__item--active' : ''}`}
                aria-label={label}
                aria-pressed={it.add ? undefined : active}
                tabIndex={open ? 0 : -1}
                onClick={() => {
                  if (it.add) onAdd();
                  else onSelect(active ? null : it.id);
                  close(false);
                }}
              >
                {it.add ? '+' : it.name.charAt(0).toUpperCase()}
              </button>
              {!!it.unread && <span className="radial__badge" aria-hidden="true">{it.unread}</span>}
              <span className="radial__label" aria-hidden="true">{it.name}</span>
            </div>
          );
        })}
      </div>

      <button
        ref={mainRef}
        type="button"
        className="radial__main"
        aria-expanded={open}
        aria-label={open ? 'Fermer le menu des apps' : `Ouvrir les apps${totalUnread ? `, ${totalUnread} non lus` : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>
        )}
      </button>
      {!open && totalUnread > 0 && <span className="radial__badge radial__badge--main" aria-hidden="true">{totalUnread}</span>}
    </div>
  );
}
