import { describe, expect, it } from 'vitest';
import { DocumentSession, tileHolders } from '../src/app/session';
import { emptyGrid, gridTileIds, writeRect } from '../src/model/tiles';

describe('tile cleanup', () => {
  it('keeps tiles held outside documents (Quick Mask) and frees the rest', () => {
    const s = new DocumentSession();
    const store = s.assets.tiles;
    const held = writeRect(store, emptyGrid(1), 0, 0, { width: 4, height: 4, data: new Uint8Array(16).fill(255) });
    const loose = writeRect(store, emptyGrid(1), 0, 0, { width: 4, height: 4, data: new Uint8Array(16).fill(9) });
    const holder = () => gridTileIds(held);
    tileHolders.push(holder);
    try {
      s.collectTiles();
      for (const id of gridTileIds(held)) expect(store.has(id)).toBe(true);
      for (const id of gridTileIds(loose)) expect(store.has(id)).toBe(false);
    } finally {
      tileHolders.splice(tileHolders.indexOf(holder), 1);
    }
    s.collectTiles();
    for (const id of gridTileIds(held)) expect(store.has(id)).toBe(false);
  });
});
