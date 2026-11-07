import { describe, expect, it } from 'vitest';
import { AxisOffsets } from '../src/ui/axis-offsets.js';

/** The dense layout the grid used to build: one running sum per line. */
function dense(n, d, entries) {
  const size = new Array(n).fill(d);
  for (const [i, s] of entries) if (i >= 0 && i < n) size[i] = s;
  const out = [0];
  for (let i = 0; i < n; i++) out.push(out[i] + size[i]);
  return out;
}

/** The dense lookup the grid used: the first line whose end passes pos, never a line of no size. */
function denseIndexAt(offsets, pos) {
  let lo = 0;
  let hi = offsets.length - 2;
  if (pos < 0) pos = 0;
  if (pos >= offsets[hi + 1]) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

describe('AxisOffsets', () => {
  it('places lines as the dense running sum does, with resized and hidden lines', () => {
    const entries = [[3, 40], [4, 0], [5, 0], [9, 7], [0, 0], [19, 60], [25, 99]];
    const o = new AxisOffsets().build(20, 20, entries);
    const want = dense(20, 20, entries);
    for (let i = 0; i <= 20; i++) expect(o.at(i)).toBe(want[i]);
    expect(o.total()).toBe(want[20]);
    for (let p = -5; p <= want[20] + 5; p++) expect(o.indexAt(p)).toBe(denseIndexAt(want, p));
  });

  it('never answers a hidden line, and the last line past the end', () => {
    const o = new AxisOffsets().build(10, 10, [[2, 0], [3, 0], [9, 0]]);
    expect(o.indexAt(20)).toBe(4); // rows 2 and 3 have no height: the pixel after row 1 is row 4's
    expect(o.indexAt(19)).toBe(1);
    expect(o.indexAt(10_000)).toBe(9);
    expect(o.size(2)).toBe(0);
  });

  it('lays out a million rows from the few that differ, at the zoom it is given', () => {
    const zoom = 4;
    const o = new AxisOffsets().build(1048576, Math.round(20 * zoom), [[5, Math.round(31 * zoom)], [1000000, 0]]);
    expect(o.at(1048576)).toBe(1048576 * 80 + (124 - 80) - 80);
    expect(o.at(6)).toBe(6 * 80 + 44);
    expect(o.indexAt(o.at(999999) + 1)).toBe(999999);
    expect(o.indexAt(o.at(1000000))).toBe(1000001); // the hidden row is passed over
    expect(o.keys.length).toBe(2);
  });

  it('translates to an origin: earlier lines get negative places and are never answered', () => {
    const o = new AxisOffsets().build(50, 10, [[1, 30]]);
    o.setOrigin(3);
    expect(o.at(3)).toBe(0);
    expect(o.at(0)).toBe(-50);
    expect(o.indexAt(-20)).toBe(3);
    expect(o.indexAt(15)).toBe(4);
  });

  it('shows a long axis through a window after a kept band', () => {
    const o = new AxisOffsets().build(1000, 10, []);
    o.setWindow({ keep: 30, base: 500, size: 200 }); // rows 0-2 stay, then rows 50-69
    expect(o.at(2)).toBe(20);
    expect(o.at(10)).toBe(30); // collapsed between the band and the window
    expect(o.at(50)).toBe(30);
    expect(o.at(51)).toBe(40);
    expect(o.at(70)).toBe(230);
    expect(o.at(900)).toBe(230); // collapsed after the window
    expect(o.total()).toBe(230);
    expect(o.indexAt(5)).toBe(0);
    expect(o.indexAt(30)).toBe(50);
    expect(o.indexAt(229)).toBe(69);
    expect(o.indexAt(5000)).toBe(69); // past the canvas: the window's last line, not the sheet's
    expect(o.size(10)).toBe(0);
  });
});
