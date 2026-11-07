// Colors travel to the GPU as packed RGBA8 (one uint32 per instance).

const cache = new Map();

/** Parses '#rgb', '#rrggbb' or '#rrggbbaa' to [r, g, b, a] in 0..255. */
export function parseHex(hex) {
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** Packs a hex color with optional alpha (0..1) for a Uint32 attribute. */
export function pack(hex, alpha = 1) {
  const key = alpha === 1 ? hex : `${hex}/${alpha}`;
  let v = cache.get(key);
  if (v === undefined) {
    const [r, g, b, a] = parseHex(hex);
    v = (r | (g << 8) | (b << 16) | (Math.round(a * alpha) << 24)) >>> 0;
    cache.set(key, v);
  }
  return v;
}

export function packRgba(r, g, b, a = 255) {
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

/** [r, g, b, a] floats in 0..1 for uniforms. */
export function toVec4(hex, alpha = 1) {
  const [r, g, b, a] = parseHex(hex);
  return [r / 255, g / 255, b / 255, (a / 255) * alpha];
}

/** Mixes two hex colors (t = 0 gives a). */
export function mixHex(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
