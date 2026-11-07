import type { Editor } from '../../editor';
import type { RGBA8 } from '../../imaging/types';
import { TILE, tileKey, type TileGrid } from '../../model/tiles';

/** Per-pixel reader over an immutable grid (clone-style previews). */
export function gridSampler(e: Editor, grid: TileGrid) {
  const store = e.assets.tiles;
  return (x: number, y: number, out: Uint8ClampedArray) => {
    const lx = Math.floor(x) - grid.x,
      ly = Math.floor(y) - grid.y;
    const id = grid.tiles[tileKey(Math.floor(lx / TILE), Math.floor(ly / TILE))];
    if (!id) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return false;
    }
    const d = store.get(id),
      i = ((((ly % TILE) + TILE) % TILE) * TILE + (((lx % TILE) + TILE) % TILE)) * 4;
    out[0] = d[i];
    out[1] = d[i + 1];
    out[2] = d[i + 2];
    out[3] = d[i + 3];
    return true;
  };
}
export function imageSampler(img: RGBA8) {
  return (x: number, y: number, out: Uint8ClampedArray) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return false;
    }
    const i = (iy * img.width + ix) * 4;
    out[0] = img.data[i];
    out[1] = img.data[i + 1];
    out[2] = img.data[i + 2];
    out[3] = img.data[i + 3];
    return true;
  };
}
