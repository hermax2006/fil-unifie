export interface Point {
  x: number; // décalage horizontal depuis le centre du bouton principal (px)
  y: number; // décalage vertical (négatif = vers le haut)
}

export interface RadialOptions {
  startDeg?: number;   // angle du premier bouton (155° = en haut à gauche)
  endDeg?: number;     // angle du dernier bouton (25° = en haut à droite)
  itemSize?: number;   // diamètre d'un bouton d'app
  minGap?: number;     // espace minimal souhaité entre deux boutons
  baseRadius?: number; // rayon préféré de l'arc
  margin?: number;     // marge minimale avec le bord de l'écran
}

/**
 * Place n boutons sur un arc au-dessus du bouton principal.
 * Le rayon grandit si les boutons se touchent, mais reste borné pour ne jamais sortir de l'écran.
 * Jusqu'à 7 boutons restent lisibles sur 360 px de large.
 */
export function radialPositions(
  n: number,
  viewportWidth: number,
  opts: RadialOptions = {},
): { radius: number; points: Point[] } {
  const { startDeg = 155, endDeg = 25, itemSize = 56, minGap = 12, baseRadius = 150, margin = 8 } = opts;
  const rad = (d: number) => (d * Math.PI) / 180;

  if (n <= 0) return { radius: baseRadius, points: [] };
  if (n === 1) return { radius: baseRadius, points: [{ x: 0, y: -baseRadius }] };

  const step = (startDeg - endDeg) / (n - 1);
  const rNoOverlap = (itemSize + minGap) / (2 * Math.sin(rad(step / 2)));
  const rMax = (viewportWidth / 2 - itemSize / 2 - margin) / Math.cos(rad(endDeg));

  let radius = Math.max(baseRadius, rNoOverlap);
  if (radius > rMax) radius = rMax; // priorité : rester dans l'écran

  const points = Array.from({ length: n }, (_, i) => {
    const a = rad(startDeg - i * step);
    return { x: Math.round(radius * Math.cos(a) * 10) / 10, y: -Math.round(radius * Math.sin(a) * 10) / 10 };
  });
  return { radius, points };
}
