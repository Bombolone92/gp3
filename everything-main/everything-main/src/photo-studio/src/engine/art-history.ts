// Art History brush: each dab scatters short stylized strokes over an area.
// Every stroke takes its color from the source history state where it starts
// and follows the source's contours (perpendicular to the luminance
// gradient), straight, loose (wandering) or curling, so the picture is
// repainted in brush strokes.

export type ArtStyle =
  | 'tight-short' | 'tight-medium' | 'tight-long' | 'loose-medium' | 'loose-long'
  | 'dab' | 'tight-curl' | 'tight-curl-long' | 'loose-curl' | 'loose-curl-long';
type StyleSpec = { label: string; length: number; curl: number; wander: number };
// Length in brush diameters; curl in radians per step; wander is random turning.
export const artStyles: Record<ArtStyle, StyleSpec> = {
  'tight-short': { label: 'Tight Short', length: 1.5, curl: 0, wander: 0.04 },
  'tight-medium': { label: 'Tight Medium', length: 3, curl: 0, wander: 0.04 },
  'tight-long': { label: 'Tight Long', length: 6, curl: 0, wander: 0.04 },
  'loose-medium': { label: 'Loose Medium', length: 3, curl: 0, wander: 0.35 },
  'loose-long': { label: 'Loose Long', length: 6, curl: 0, wander: 0.35 },
  dab: { label: 'Dab', length: 0, curl: 0, wander: 0 },
  'tight-curl': { label: 'Tight Curl', length: 3, curl: 0.45, wander: 0.05 },
  'tight-curl-long': { label: 'Tight Curl Long', length: 6, curl: 0.3, wander: 0.05 },
  'loose-curl': { label: 'Loose Curl', length: 3, curl: 0.35, wander: 0.3 },
  'loose-curl-long': { label: 'Loose Curl Long', length: 6, curl: 0.25, wander: 0.3 },
};
export type ArtStroke = { color: [number, number, number]; alpha: number; points: [number, number][] };
export type ArtOptions = {
  style: ArtStyle;
  area: number; // radius in px over which strokes start
  size: number; // brush diameter in px
  tolerance: number; // 0..100: only paint where the canvas differs from the source this much
  seed: number;
  // Strokes per dab; default scales with the area.
  count?: number;
};
type Sampler = (x: number, y: number, out: Uint8ClampedArray) => boolean;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const luma = (p: Uint8ClampedArray) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

/** Strokes for one dab at (cx, cy). `current` reads the canvas for the tolerance test. */
export function artStrokes(source: Sampler, current: Sampler | undefined, cx: number, cy: number, o: ArtOptions): ArtStroke[] {
  const spec = artStyles[o.style] ?? artStyles['tight-medium'];
  const random = rng(o.seed);
  const size = Math.max(1, o.size);
  const area = Math.max(0, o.area);
  const step = Math.max(1, size * 0.5);
  const steps = Math.max(1, Math.round((spec.length * size) / step));
  const count = o.count ?? Math.max(1, Math.min(48, Math.round((area * area) / (size * size * Math.max(1, spec.length) * 0.6)) || 1));
  const tol = (Math.max(0, Math.min(100, o.tolerance)) / 100) * 255;
  const px = new Uint8ClampedArray(4),
    cur = new Uint8ClampedArray(4),
    a = new Uint8ClampedArray(4),
    b = new Uint8ClampedArray(4);
  const gradient = (x: number, y: number): [number, number] => {
    const d = Math.max(1, size * 0.5);
    source(x + d, y, a);
    source(x - d, y, b);
    const gx = luma(a) - luma(b);
    source(x, y + d, a);
    source(x, y - d, b);
    return [gx, luma(a) - luma(b)];
  };
  const out: ArtStroke[] = [];
  for (let n = 0; n < count; n++) {
    // Uniform start points over the disk.
    const r = area * Math.sqrt(random()),
      t = random() * Math.PI * 2;
    let x = cx + Math.cos(t) * r,
      y = cy + Math.sin(t) * r;
    if (!source(x, y, px) || px[3] === 0) continue;
    if (tol > 0 && current) {
      current(x, y, cur);
      const diff = Math.max(Math.abs(cur[0] - px[0]), Math.abs(cur[1] - px[1]), Math.abs(cur[2] - px[2]), Math.abs(cur[3] - px[3]));
      if (diff < tol) continue;
    }
    const stroke: ArtStroke = { color: [px[0], px[1], px[2]], alpha: px[3] / 255, points: [[x, y]] };
    // Follow the contour; flat areas get a random but steady direction.
    let [gx, gy] = gradient(x, y);
    let angle = Math.hypot(gx, gy) > 2 ? Math.atan2(gy, gx) + Math.PI / 2 : random() * Math.PI * 2;
    if (random() < 0.5) angle += Math.PI;
    const turn = spec.curl * (random() < 0.5 ? -1 : 1);
    for (let k = 0; k < steps && spec.length > 0; k++) {
      [gx, gy] = gradient(x, y);
      if (Math.hypot(gx, gy) > 2 && !spec.curl) {
        // Bend toward the local contour, keeping the stroke's heading.
        let target = Math.atan2(gy, gx) + Math.PI / 2;
        if (Math.cos(target - angle) < 0) target += Math.PI;
        angle += Math.atan2(Math.sin(target - angle), Math.cos(target - angle)) * 0.5;
      }
      angle += turn + (random() - 0.5) * 2 * spec.wander;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      stroke.points.push([x, y]);
    }
    out.push(stroke);
  }
  return out;
}
