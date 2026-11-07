// Small shared helpers for the shader node runtime.

/** Stable pseudo-random value in [0, 1) from a name (Object Info ▸ Random). */
export function hashName(name: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
