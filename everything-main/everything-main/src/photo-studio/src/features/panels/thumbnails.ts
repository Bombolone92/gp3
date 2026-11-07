import type { TileGrid, TileStore } from '../../model/tiles';
import { TILE, tileKey } from '../../model/tiles';

const cache = new WeakMap<TileGrid, Map<string, string>>();
const checker = (x: number, y: number) => (((x >> 2) + (y >> 2)) & 1 ? 204 : 255);

/** A small data-URL thumbnail of a tile grid over a document-sized frame,
 * sampled directly from tiles (nearest) so it costs O(thumbnail pixels). */
export function gridThumbnail(store: TileStore, grid: TileGrid, docW: number, docH: number, size = 40, mask = false): string {
  const key = `${docW}x${docH}:${size}:${mask}`;
  let entry = cache.get(grid);
  const hit = entry?.get(key);
  if (hit) return hit;
  const scale = Math.min(size / docW, size / docH);
  const w = Math.max(1, Math.round(docW * scale)),
    h = Math.max(1, Math.round(docH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  // CPU-backed: toDataURL must not wait for a busy GPU queue (seconds with large uploads).
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = c.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = Math.floor((x + 0.5) / scale) - grid.x,
        dy = Math.floor((y + 0.5) / scale) - grid.y;
      const tx = Math.floor(dx / TILE),
        ty = Math.floor(dy / TILE);
      const id = grid.tiles[tileKey(tx, ty)];
      const o = (y * w + x) * 4;
      const lx = dx - tx * TILE,
        ly = dy - ty * TILE;
      if (grid.channels === 1) {
        const v = id ? store.get(id)[ly * TILE + lx] : (grid.fill ?? 0);
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = 255;
        continue;
      }
      const bg = checker(x, y);
      if (!id) {
        d[o] = d[o + 1] = d[o + 2] = bg;
        d[o + 3] = 255;
        continue;
      }
      const t = store.get(id),
        i = (ly * TILE + lx) * 4,
        a = t[i + 3] / 255;
      d[o] = t[i] * a + bg * (1 - a);
      d[o + 1] = t[i + 1] * a + bg * (1 - a);
      d[o + 2] = t[i + 2] * a + bg * (1 - a);
      d[o + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  if (!entry) {
    entry = new Map();
    cache.set(grid, entry);
  }
  entry.set(key, url);
  return url;
}
