// A small, serializable gradient description shared by Gradient Map and
// (later) gradient fills/tools. Locations and midpoints are fractions in [0, 1].
// `midpoint` belongs to the segment that starts at the stop: it is where, within
// that segment, the blend reaches 50 percent (0.5 = linear).
export type RGB8 = [number, number, number];
export type GradientColorStop = { location: number; color: RGB8; midpoint?: number };
export type GradientOpacityStop = { location: number; opacity: number; midpoint?: number };
export type Gradient = { stops: GradientColorStop[]; opacityStops?: GradientOpacityStop[] };

export function twoColorGradient(from: RGB8, to: RGB8): Gradient {
  return {
    stops: [
      { location: 0, color: [...from] as RGB8, midpoint: 0.5 },
      { location: 1, color: [...to] as RGB8, midpoint: 0.5 },
    ],
  };
}

// Remaps the position inside a segment so that t = midpoint lands on 0.5.
function bias(t: number, midpoint: number | undefined): number {
  const m = midpoint === undefined ? 0.5 : Math.min(0.99, Math.max(0.01, midpoint));
  if (m === 0.5) return t;
  return Math.pow(t, Math.log(0.5) / Math.log(m));
}

function sortedStops<T extends { location: number }>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => a.location - b.location);
}

// Locates t among stops and returns [index of left stop, blend in [0, 1]].
function locate(stops: readonly { location: number; midpoint?: number }[], t: number): [number, number] {
  const n = stops.length;
  if (t <= stops[0].location) return [0, 0];
  if (t >= stops[n - 1].location) return [n - 1, 0];
  let i = 0;
  while (i < n - 2 && t >= stops[i + 1].location) i++;
  const a = stops[i],
    b = stops[i + 1];
  const span = b.location - a.location;
  if (span <= 0) return [i + 1, 0];
  return [i, bias((t - a.location) / span, a.midpoint)];
}

// Fills `out` with [r, g, b, a]: colors in 0..255 (floats), alpha in [0, 1].
export function sampleGradient(g: Gradient, t: number, out: number[] | Float32Array = [0, 0, 0, 1]) {
  const stops = sortedStops(g.stops);
  return sampleSorted(stops, g.opacityStops ? sortedStops(g.opacityStops) : undefined, t, out);
}

function sampleSorted(
  stops: GradientColorStop[],
  opacity: GradientOpacityStop[] | undefined,
  t: number,
  out: number[] | Float32Array,
) {
  if (!stops.length) {
    out[0] = out[1] = out[2] = 0;
  } else {
    const [i, f] = locate(stops, t);
    const a = stops[i].color,
      b = stops[Math.min(i + 1, stops.length - 1)].color;
    for (let c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * f;
  }
  if (opacity?.length) {
    const [i, f] = locate(opacity, t);
    const a = opacity[i].opacity,
      b = opacity[Math.min(i + 1, opacity.length - 1)].opacity;
    out[3] = a + (b - a) * f;
  } else out[3] = 1;
  return out;
}

// n samples spanning [0, 1] inclusive as RGBA floats (colors 0..1, alpha 0..1).
export function gradientTable(g: Gradient, n = 256, reverse = false): Float32Array {
  const table = new Float32Array(n * 4);
  const stops = sortedStops(g.stops);
  const opacity = g.opacityStops ? sortedStops(g.opacityStops) : undefined;
  const tmp = [0, 0, 0, 1];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    sampleSorted(stops, opacity, reverse ? 1 - t : t, tmp);
    table[i * 4] = tmp[0] / 255;
    table[i * 4 + 1] = tmp[1] / 255;
    table[i * 4 + 2] = tmp[2] / 255;
    table[i * 4 + 3] = tmp[3];
  }
  return table;
}
