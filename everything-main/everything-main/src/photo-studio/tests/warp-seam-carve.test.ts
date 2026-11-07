import { describe, expect, it } from 'vitest';
import { KEPT, carveHeight, carveWidth, contextScale, protectionMap, seamCount, seamOrder, skinMask } from '../src/imaging/warp/seam-carve';
import { rgba8, type RGBA8 } from '../src/imaging/types';

/** Smooth gradient background with a sharp, noisy block (columns bx..bx+bw). */
function scene(w: number, h: number, bx: number, bw: number): RGBA8 {
  const img = rgba8(w, h);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const inBlock = x >= bx && x < bx + bw && y >= 5 && y < h - 5;
      const v = inBlock ? rand() : 100 + x * 0.2;
      img.data.set([v, inBlock ? 255 - v : v, 80, 255], k);
    }
  return img;
}
const column = (img: RGBA8, x: number) => Array.from({ length: img.height }, (_, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)));
const row = (img: RGBA8, y: number) => Array.from(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4));

describe('seam carving', () => {
  it('records one pixel per row for every seam', () => {
    const img = scene(48, 30, 20, 8);
    const order = seamOrder(img, 'vertical', 24);
    for (let y = 0; y < 30; y++) {
      const values = Array.from(order.subarray(y * 48, (y + 1) * 48)).filter((v) => v !== KEPT).sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: 24 }, (_, i) => i));
    }
    // Seams are connected: a seam moves at most one column between rows.
    for (let s = 0; s < 24; s++) {
      let prev = -1;
      for (let y = 0; y < 30; y++) {
        const x = Array.from(order.subarray(y * 48, (y + 1) * 48)).indexOf(s);
        if (prev >= 0) expect(Math.abs(x - prev)).toBeLessThanOrEqual(1);
        prev = x;
      }
    }
    expect(seamCount(order, 48)).toBe(24);
  });

  it('produces the requested size when narrowing and widening', () => {
    const img = scene(40, 24, 15, 6);
    const orders = { vertical: seamOrder(img, 'vertical', 24), horizontal: seamOrder(img, 'horizontal', 14) };
    for (const [w, h] of [
      [30, 24],
      [52, 24],
      [40, 18],
      [40, 30],
      [28, 20],
      [55, 31],
      [12, 9],
      [70, 40],
    ]) {
      const out = contextScale(img, orders, w, h);
      expect([out.width, out.height]).toEqual([w, h]);
    }
    // Amount 0 is plain resampling to the same size.
    const plain = contextScale(img, orders, 40, 24, 0);
    expect(Array.from(plain.data)).toEqual(Array.from(img.data));
  });

  it('keeps detailed areas while removing smooth ones', () => {
    const img = scene(60, 30, 25, 10);
    const order = seamOrder(img, 'vertical', 30);
    const out = carveWidth(img, order, 40).image;
    expect(out.width).toBe(40);
    // The noisy block survives as ten intact consecutive columns.
    const block = Array.from({ length: 10 }, (_, i) => JSON.stringify(column(img, 25 + i)));
    const cols = Array.from({ length: 40 }, (_, x) => JSON.stringify(column(out, x)));
    const start = cols.indexOf(block[0]);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(cols.slice(start, start + 10)).toEqual(block);
  });

  it('leaves protected regions untouched, even where they are smooth', () => {
    // A flat image: without protection seams could go anywhere.
    const img = rgba8(50, 20, [120, 120, 120, 255]);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 50; x++) img.data[(y * 50 + x) * 4] = 100 + x;
    const mask = { width: 50, height: 20, data: new Uint8Array(50 * 20) };
    for (let y = 0; y < 20; y++) for (let x = 10; x < 22; x++) mask.data[y * 50 + x] = 255;
    const protect = protectionMap(img, { mask });
    const order = seamOrder(img, 'vertical', 25, protect);
    for (let y = 0; y < 20; y++) for (let x = 10; x < 22; x++) expect(order[y * 50 + x]).toBe(KEPT);
    const out = carveWidth(img, order, 30).image;
    // Columns 10..21 appear unchanged and adjacent in the result.
    const reds = Array.from({ length: 30 }, (_, x) => out.data[x * 4]);
    const start = reds.indexOf(110);
    expect(reds.slice(start, start + 12)).toEqual(Array.from({ length: 12 }, (_, i) => 110 + i));
    // Horizontal seams skip a protected band too.
    const hmask = { width: 50, height: 20, data: new Uint8Array(50 * 20) };
    for (let y = 8; y < 12; y++) for (let x = 0; x < 50; x++) hmask.data[y * 50 + x] = 255;
    const horder = seamOrder(img, 'horizontal', 10, protectionMap(img, { mask: hmask }));
    for (let y = 8; y < 12; y++) for (let x = 0; x < 50; x++) expect(horder[y * 50 + x]).toBe(KEPT);
    expect(carveHeight(img, horder, 12).height).toBe(12);
  });

  it('detects skin tones for protection', () => {
    const img = rgba8(2, 1);
    img.data.set([224, 172, 140, 255, 60, 120, 200, 255]);
    expect(Array.from(skinMask(img))).toEqual([255, 0]);
  });

  it('duplicates seams when widening', () => {
    const img = scene(30, 10, 12, 4);
    const order = seamOrder(img, 'vertical', 10);
    const out = carveWidth(img, order, 36).image;
    expect(out.width).toBe(36);
    // Every source pixel of a row is still present, in order.
    const src = row(img, 3),
      dst = row(out, 3);
    let i = 0;
    for (let j = 0; i < src.length / 4 && j < dst.length / 4; j++) if (dst.slice(j * 4, j * 4 + 4).join() === src.slice(i * 4, i * 4 + 4).join()) i++;
    expect(i).toBe(30);
  });
});
