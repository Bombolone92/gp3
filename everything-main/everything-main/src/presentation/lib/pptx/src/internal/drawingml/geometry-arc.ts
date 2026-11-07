import type { GeomPoint } from "./custom-geometry.ts";

export type GeometryArcSegment =
  | { readonly kind: "line"; readonly end: GeomPoint }
  | {
      readonly kind: "arc";
      readonly rx: number;
      readonly ry: number;
      readonly clockwise: boolean;
      readonly end: GeomPoint;
    };

const FULL_TURN = 21_600_000;
const TAU = 2 * Math.PI;
const radians = (angle: number): number =>
  ((angle % FULL_TURN) / FULL_TURN) * TAU;

/** Exact axis-aligned ellipse segments for DrawingML arcTo (§20.1.9.4).
 * The current pen fixes the start point; angles describe rays, not ellipse
 * parameters. The native reference clamps a sweep to one signed full turn and
 * uses parameter angles when an axis radius is zero. Signed radii are retained
 * when converting angles; their product determines physical sweep direction.
 * Splitting at half turns permits exact SVG arcs, including a full ellipse.
 */
export const resolveGeometryArc = (
  startX: number,
  startY: number,
  wR: number,
  hR: number,
  stAng: number,
  swAng: number,
): readonly GeometryArcSegment[] => {
  if (![startX, startY, wR, hR, stAng, swAng].every(Number.isFinite))
    throw new RangeError("Geometry arc values must be finite");
  if (swAng === 0 || (wR === 0 && hR === 0)) return [];
  const sweep = Math.max(-FULL_TURN, Math.min(FULL_TURN, swAng));
  const collapsed = wR === 0 || hR === 0;
  const parameter = (angle: number): number => {
    const theta = radians(angle);
    return collapsed
      ? theta
      : Math.atan2(wR * Math.sin(theta), hR * Math.cos(theta));
  };
  const start = parameter(stAng);
  let span = parameter((stAng % FULL_TURN) + sweep) - start;
  const full = Math.abs(sweep) === FULL_TURN;
  if (full) span = Math.sign(sweep) * TAU;
  else if (collapsed) span = (sweep / FULL_TURN) * TAU;
  else if (sweep > 0 && span < 0) span += TAU;
  else if (sweep < 0 && span > 0) span -= TAU;
  if (span === 0) return [];

  const cx = startX - wR * Math.cos(start),
    cy = startY - hR * Math.sin(start);
  const point = (angle: number): GeomPoint => ({
    x: cx + wR * Math.cos(angle),
    y: cy + hR * Math.sin(angle),
  });
  const end = full ? { x: startX, y: startY } : point(start + span);
  if (collapsed) {
    // A collapsed ellipse can reverse along its remaining axis. SVG's zero-
    // radius A command draws only an endpoint line and loses those extrema.
    const phase = wR === 0 ? Math.PI / 2 : 0,
      low = Math.min(start, start + span),
      high = Math.max(start, start + span),
      angles: number[] = [];
    for (
      let k = Math.floor((low - phase) / Math.PI) + 1;
      phase + k * Math.PI < high;
      k++
    )
      angles.push(phase + k * Math.PI);
    if (span < 0) angles.reverse();
    return [
      ...angles.map((angle): GeometryArcSegment => ({
        kind: "line",
        end: point(angle),
      })),
      { kind: "line", end },
    ];
  }
  const count = Math.ceil(Math.abs(span) / Math.PI),
    clockwise = Math.sign(span) === Math.sign(wR) * Math.sign(hR);
  return Array.from({ length: count }, (_, i): GeometryArcSegment => ({
    kind: "arc",
    rx: Math.abs(wR),
    ry: Math.abs(hR),
    clockwise,
    end: i === count - 1 ? end : point(start + (span * (i + 1)) / count),
  }));
};
