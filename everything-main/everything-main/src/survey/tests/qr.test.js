import { describe, it, expect } from 'vitest';
import qrcode from 'qrcode-generator';
import { qrMatrix, qrSvg } from '../src/lib/qr.js';

/** True when a 7x7 finder pattern (dark ring, light ring, 3x3 core) sits at (r, c). */
function finderAt(m, r, c) {
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3));
      const want = ring !== 2;
      if (m[r + i][c + j] !== want) return false;
    }
  }
  return true;
}

describe('qr', () => {
  it('picks the smallest version that fits at level M', () => {
    // Byte capacity at level M: version 1 = 14, 2 = 26, 4 = 62.
    expect(qrMatrix('short').length).toBe(21);
    expect(qrMatrix('https://example.com').length).toBe(25);
    expect(qrMatrix(`https://survey.puter.com/r/#ada-lovelace/${'a'.repeat(10)}xyz`).length).toBe(33);
  });

  it('draws the three finder patterns', () => {
    const m = qrMatrix('https://survey.puter.com/r/#ada/k3j4h5l6m7');
    const n = m.length;
    expect(finderAt(m, 0, 0)).toBe(true);
    expect(finderAt(m, 0, n - 7)).toBe(true);
    expect(finderAt(m, n - 7, 0)).toBe(true);
  });

  it('is deterministic', () => {
    expect(qrSvg('https://example.com/a')).toBe(qrSvg('https://example.com/a'));
    expect(qrSvg('https://example.com/a')).not.toBe(qrSvg('https://example.com/b'));
  });

  it('encodes text as UTF-8 bytes', () => {
    const lib = qrcode(0, 'M');
    lib.addData('cafÃ©', 'Byte');
    lib.make();
    const m = qrMatrix('café');
    expect(m.length).toBe(lib.getModuleCount());
    m.forEach((row, r) => row.forEach((dark, c) => expect(dark).toBe(lib.isDark(r, c))));
  });

  it('produces well-formed SVG with a quiet zone', () => {
    const svg = qrSvg('https://example.com', { margin: 4, title: 'Code <for> "you"' });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 33 33');
    expect(root.querySelector('title').textContent).toBe('Code <for> "you"');
    // Every dark run starts inside the quiet zone boundary.
    const d = root.querySelector('path').getAttribute('d');
    const starts = [...d.matchAll(/M(\d+) (\d+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
    expect(starts.length).toBeGreaterThan(10);
    for (const [x, y] of starts) {
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(y).toBeLessThan(29);
    }
  });
});
