// CPU procedural textures (for displacement, geometry nodes and baking).
// Gradient noise is an original implementation using a hashed lattice.

function hash3(x: number, y: number, z: number) {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

const GRAD = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Signed gradient noise in roughly [-1, 1]. */
export function gradientNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const u = fade(fx),
    v = fade(fy),
    w = fade(fz);
  let res = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1,
      dy = (c >> 1) & 1,
      dz = (c >> 2) & 1;
    const g = GRAD[hash3(ix + dx, iy + dy, iz + dz) % 12];
    const d = g[0] * (fx - dx) + g[1] * (fy - dy) + g[2] * (fz - dz);
    res += d * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return res;
}

/** Fractal noise in [0,1] (detail octaves, roughness = gain). */
export function fbm(x: number, y: number, z: number, detail = 2, roughness = 0.5, lacunarity = 2): number {
  let amp = 1,
    sum = 0,
    norm = 0,
    f = 1;
  const oct = Math.floor(detail);
  for (let i = 0; i <= oct; i++) {
    sum += gradientNoise(x * f, y * f, z * f) * amp;
    norm += amp;
    amp *= roughness;
    f *= lacunarity;
  }
  const rem = detail - oct;
  if (rem > 0) {
    sum += gradientNoise(x * f, y * f, z * f) * amp * rem;
    norm += amp * rem;
  }
  return 0.5 + (sum / norm) * 0.75;
}

export function voronoi(x: number, y: number, z: number, randomness = 1): { f1: number; f2: number; cell: [number, number, number] } {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let f1 = Infinity,
    f2 = Infinity;
  let cell: [number, number, number] = [0, 0, 0];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const cx = ix + dx,
          cy = iy + dy,
          cz = iz + dz;
        const h = hash3(cx, cy, cz);
        const px = cx + ((h & 1023) / 1023) * randomness,
          py = cy + (((h >> 10) & 1023) / 1023) * randomness,
          pz = cz + (((h >> 20) & 1023) / 1023) * randomness;
        const d = Math.hypot(px - x, py - y, pz - z);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          cell = [(h & 255) / 255, ((h >> 8) & 255) / 255, ((h >> 16) & 255) / 255];
        } else if (d < f2) f2 = d;
      }
  return { f1, f2, cell };
}

export function whiteNoise(x: number, y: number, z: number) {
  const h = hash3(Math.floor(x * 1e4), Math.floor(y * 1e4), Math.floor(z * 1e4));
  return h / 4294967295;
}

/** Legacy-style texture data-block evaluation used by the Displace modifier. */
export function proceduralTexture(tex: Record<string, unknown>, x: number, y: number, z: number): number {
  const scale = (tex.noise_scale as number) || 0.25;
  const depth = (tex.noise_depth as number) ?? 2;
  const contrast = (tex.contrast as number) ?? 1,
    brightness = (tex.brightness as number) ?? 1;
  const sx = x / scale,
    sy = y / scale,
    sz = z / scale;
  let v = 0;
  switch (tex.type) {
    case 'CLOUDS':
      v = fbm(sx, sy, sz, depth, 0.5);
      break;
    case 'VORONOI':
      v = Math.min(1, voronoi(sx, sy, sz).f1);
      break;
    case 'WOOD':
      v = 0.5 + 0.5 * Math.sin((Math.hypot(sx, sy) + fbm(sx, sy, sz, 1) * ((tex.turbulence as number) ?? 5) * 0.2) * 6);
      break;
    case 'MARBLE':
      v = 0.5 + 0.5 * Math.sin((sx + sy + sz) * 2 + fbm(sx, sy, sz, depth) * ((tex.turbulence as number) ?? 5));
      break;
    case 'BLEND':
      v = Math.max(0, Math.min(1, (x + 1) / 2));
      break;
    case 'STUCCI':
      v = fbm(sx * 2, sy * 2, sz * 2, depth, 0.6);
      break;
    case 'NOISE':
      v = whiteNoise(x, y, z);
      break;
    case 'MAGIC': {
      const t = Math.sin((sx + sy) * 2) * Math.cos((sy + sz) * 2) * Math.sin((sz + sx) * 2);
      v = 0.5 + 0.5 * t;
      break;
    }
    default:
      v = fbm(sx, sy, sz, depth);
  }
  return Math.max(0, (v - 0.5) * contrast + 0.5) * brightness;
}
