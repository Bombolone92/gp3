import { mulberry32 } from '../gradient/color';
import type { RGBA8 } from '../types';
import type { Pattern } from './pattern';

// Original procedural patterns. Every generator is periodic in both axes over
// its tile (noise uses wrapped lattices, circles are drawn at wrapped
// positions) so tiles repeat without seams. Seeds are fixed: same pixels on
// every run.
type RGB = [number, number, number];
const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function tile(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set(fn(x + 0.5, y + 0.5), (y * w + x) * 4);
  return { width: w, height: h, data };
}

// Periodic value noise: a cx x cy lattice wrapped over the tile, smoothly
// interpolated. Fractal sums double the lattice per octave.
function periodicNoise(w: number, h: number, cx: number, cy: number, seed: number) {
  const rand = mulberry32(seed);
  const lat = Float32Array.from({ length: cx * cy }, rand);
  return (x: number, y: number) => {
    const u = (x / w) * cx, v = (y / h) * cy;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = smooth(u - i), fv = smooth(v - j);
    const i0 = ((i % cx) + cx) % cx, j0 = ((j % cy) + cy) % cy;
    const i1 = (i0 + 1) % cx, j1 = (j0 + 1) % cy;
    const a = lat[j0 * cx + i0], b = lat[j0 * cx + i1], c = lat[j1 * cx + i0], d = lat[j1 * cx + i1];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  };
}
function fractal(w: number, h: number, base: number, octaves: number, seed: number) {
  const layers = Array.from({ length: octaves }, (_, o) => periodicNoise(w, h, base << o, base << o, seed + o * 101));
  return (x: number, y: number) => {
    let v = 0, amp = 0.5, total = 0;
    for (const n of layers) {
      v += n(x, y) * amp;
      total += amp;
      amp *= 0.5;
    }
    return v / total;
  };
}
// Distance to the nearest point of a wrapped lattice of circles.
const wrapDelta = (d: number, n: number) => d - n * Math.round(d / n);

const generators: { id: string; name: string; make: () => RGBA8 }[] = [
  {
    id: 'checker', name: 'Checker',
    make: () => tile(32, 32, (x, y) => ((Math.floor(x / 16) + Math.floor(y / 16)) & 1 ? [72, 74, 84, 255] : [232, 230, 222, 255])),
  },
  {
    id: 'stripes', name: 'Stripes',
    make: () => tile(32, 32, (x) => {
      // Two 16 px bands with a one pixel soft edge on each side.
      const d = Math.abs(((x % 32) + 32) % 32 - 16);
      const t = clamp(d - 7.5);
      const c = mix([38, 70, 120], [236, 226, 204], t);
      return [c[0], c[1], c[2], 255];
    }),
  },
  {
    id: 'dots', name: 'Dots',
    make: () => tile(24, 24, (x, y) => {
      const r = Math.hypot(wrapDelta(x - 12, 24), wrapDelta(y - 12, 24));
      return [40, 40, 46, clamp(6.5 - r) * 255];
    }),
  },
  {
    id: 'grid', name: 'Grid',
    make: () => tile(32, 32, (x, y) => {
      const dx = Math.abs(wrapDelta(x, 32)), dy = Math.abs(wrapDelta(y, 32));
      const a = Math.max(clamp(1 - dx), clamp(1 - dy));
      return [70, 110, 160, a * 230];
    }),
  },
  {
    id: 'noise', name: 'Fine Noise',
    make: () => {
      const rand = mulberry32(2024);
      return tile(128, 128, () => {
        const v = 96 + rand() * 64;
        return [v, v, v, 255];
      });
    },
  },
  {
    id: 'wood', name: 'Wood Grain',
    make: () => {
      const n = fractal(256, 256, 4, 4, 11), fine = periodicNoise(256, 256, 64, 8, 12);
      return tile(256, 256, (x, y) => {
        // Vertical grain: rings across x, warped by low-frequency noise.
        const warp = n(x, y) * 3.2;
        const rings = (Math.sin(((x / 256) * 6 + warp) * Math.PI * 2) + 1) / 2;
        const t = clamp(Math.pow(rings, 2.4) * 0.8 + fine(x, y) * 0.25);
        const c = mix([176, 120, 72], [102, 62, 34], t);
        return [c[0], c[1], c[2], 255];
      });
    },
  },
  {
    id: 'paper', name: 'Paper',
    make: () => {
      const n = fractal(256, 256, 8, 5, 21), fibers = periodicNoise(256, 256, 32, 16, 22);
      return tile(256, 256, (x, y) => {
        const f = Math.abs(fibers(x, y) - 0.5) < 0.015 ? -6 : 0;
        const v = (n(x, y) - 0.5) * 26 + f;
        return [240 + v, 235 + v, 222 + v, 255];
      });
    },
  },
  {
    id: 'canvas', name: 'Canvas Weave',
    make: () => {
      const n = periodicNoise(128, 128, 32, 32, 31);
      return tile(128, 128, (x, y) => {
        // Over-under threads: alternate which direction is on top per cell.
        const cx = Math.floor(x / 4), cy = Math.floor(y / 4);
        const warpOnTop = (cx + cy) & 1;
        const thread = warpOnTop ? Math.sin(((x % 4) / 4) * Math.PI) : Math.sin(((y % 4) / 4) * Math.PI);
        const v = 150 + thread * 60 + (n(x, y) - 0.5) * 30;
        return [v * 1.02, v * 0.98, v * 0.88, 255];
      });
    },
  },
  {
    id: 'bricks', name: 'Bricks',
    make: () => {
      const n = fractal(128, 96, 8, 3, 41);
      const rand = mulberry32(42);
      const tone = Array.from({ length: 8 }, () => rand());
      return tile(128, 96, (x, y) => {
        const row = Math.floor(y / 24), shift = row & 1 ? 32 : 0;
        const bx = ((x + shift) % 128 + 128) % 128;
        const col = Math.floor(bx / 64);
        const ex = Math.min(bx % 64, 64 - (bx % 64)), ey = Math.min(y % 24, 24 - (y % 24));
        const mortar = clamp(2.5 - Math.min(ex, ey));
        const t = tone[(row * 2 + col) % 8];
        const brick = mix([160, 70, 50], [124, 48, 36], t);
        const g = (n(x, y) - 0.5) * 30;
        const c = mix([brick[0] + g, brick[1] + g, brick[2] + g], [196, 190, 178], mortar);
        return [c[0], c[1], c[2], 255];
      });
    },
  },
  {
    id: 'hexagons', name: 'Hexagons',
    make: () => {
      // Pointy-top hex lattice, two columns by two rows per tile. Pixels are
      // mapped into ideal lattice units so the tile edges land on lattice
      // periods exactly.
      const W = 56, H = 48, R = 16, A = Math.sqrt(3) * R;
      const sx = (2 * A) / W, sy = (3 * R) / H;
      return tile(W, H, (x, y) => {
        const X = x * sx, Y = y * sy;
        let d1 = Infinity, d2 = Infinity, c1x = 0, c1y = 0, c2x = 0, c2y = 0;
        const j0 = Math.round(Y / (1.5 * R));
        for (let j = j0 - 1; j <= j0 + 1; j++) {
          const off = j & 1 ? A / 2 : 0;
          const i0 = Math.round((X - off) / A);
          for (let i = i0 - 1; i <= i0 + 1; i++) {
            const cx = i * A + off, cy = j * 1.5 * R;
            const d = (X - cx) ** 2 + (Y - cy) ** 2;
            if (d < d1) { d2 = d1; c2x = c1x; c2y = c1y; d1 = d; c1x = cx; c1y = cy; }
            else if (d < d2) { d2 = d; c2x = cx; c2y = cy; }
          }
        }
        // Distance to the Voronoi edge between the two nearest centers.
        const edge = (d2 - d1) / (2 * Math.hypot(c2x - c1x, c2y - c1y)) / sx;
        const line = clamp(1.6 - edge);
        const c = mix([230, 220, 196], [92, 84, 72], line);
        return [c[0], c[1], c[2], 255];
      });
    },
  },
  {
    id: 'hatch', name: 'Diagonal Hatch',
    make: () => tile(16, 16, (x, y) => {
      // Lines along x + y = k * 8; perpendicular distance is |delta| / sqrt 2.
      const d = Math.abs(wrapDelta(x + y, 8)) / Math.SQRT2;
      return [30, 30, 36, clamp(1.2 - d) * 255];
    }),
  },
  {
    id: 'bubbles', name: 'Bubbles',
    make: () => {
      const rand = mulberry32(77);
      const S = 128;
      const bubbles = Array.from({ length: 18 }, () => ({ x: rand() * S, y: rand() * S, r: 4 + rand() * 14 }));
      return tile(S, S, (x, y) => {
        let a = 0, hi = 0;
        for (const b of bubbles) {
          const dx = wrapDelta(x - b.x, S), dy = wrapDelta(y - b.y, S);
          const d = Math.hypot(dx, dy);
          const ring = clamp(1 - Math.abs(d - b.r) / 1.2);
          const body = clamp(b.r - d) * 0.18;
          a = Math.max(a, ring * 0.9, body);
          // Small highlight up-left of the center.
          hi = Math.max(hi, clamp(1 - Math.hypot(dx + b.r * 0.4, dy + b.r * 0.4) / (b.r * 0.22)));
        }
        const c = mix([120, 180, 230], [255, 255, 255], hi);
        return [c[0], c[1], c[2], Math.max(a, hi) * 255];
      });
    },
  },
];

let cache: Pattern[] | undefined;
// The preset list, generated once on first use (about 0.4 MB of tiles).
export function patternPresets(): Pattern[] {
  return (cache ??= generators.map((g) => ({ id: g.id, name: g.name, tile: g.make() })));
}
export function findPatternPreset(id: string): Pattern | undefined {
  return patternPresets().find((p) => p.id === id);
}
export const patternPresetIds = generators.map((g) => g.id);
