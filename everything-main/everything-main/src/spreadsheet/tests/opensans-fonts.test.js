import fs from 'node:fs';
import { expect, it } from 'vitest';
import { xlsxMaximumDigitWidth, xlsxColumnPixels, xlsxWidthFromPixels } from '../src/core/xlsx-styles.js';
import { fontKeyFor, fontStack, fontName } from '../src/core/format.js';

// Read the bundled font's real Unicode digit advances so the column converter
// cannot silently drift away from the glyphs used by the browser.
function digitMetrics(file) {
  const b = fs.readFileSync(new URL(`../public/fonts/opensans/${file}`, import.meta.url));
  const tables = new Map();
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const p = 12 + i * 16;
    tables.set(b.toString('ascii', p, p + 4), b.readUInt32BE(p + 8));
  }
  const cmap = tables.get('cmap');
  let map;
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i++) {
    const p = cmap + 4 + i * 8, sub = cmap + b.readUInt32BE(p + 4);
    if (b.readUInt16BE(sub) === 4) { map = sub; break; }
  }
  expect(map).toBeDefined();
  const count = b.readUInt16BE(map + 6) / 2, ends = map + 14;
  const starts = ends + count * 2 + 2, deltas = starts + count * 2, offsets = deltas + count * 2;
  const advances = [];
  for (let cp = 48; cp <= 57; cp++) {
    for (let i = 0; i < count; i++) {
      if (cp < b.readUInt16BE(starts + 2 * i) || cp > b.readUInt16BE(ends + 2 * i)) continue;
      const offset = b.readUInt16BE(offsets + 2 * i), delta = b.readInt16BE(deltas + 2 * i);
      let glyph = offset ? b.readUInt16BE(offsets + 2 * i + offset + 2 * (cp - b.readUInt16BE(starts + 2 * i))) : cp;
      if (!offset || glyph) glyph = (glyph + delta) & 0xffff;
      const metrics = b.readUInt16BE(tables.get('hhea') + 34);
      advances.push(b.readUInt16BE(tables.get('hmtx') + Math.min(glyph, metrics - 1) * 4));
      break;
    }
  }
  expect(advances).toHaveLength(10);
  return Math.max(...advances) / b.readUInt16BE(tables.get('head') + 18);
}

it.each([
  ['Regular', {}], ['Bold', { bold: true }],
  ['Italic', { italic: true }], ['BoldItalic', { bold: true, italic: true }],
])('uses the %s font metrics for Normal column widths at varied sizes', (face, style) => {
  const em = digitMetrics(`OpenSans-${face}.ttf`);
  for (const name of ['Open Sans', 'OPEN SANS', 'Open Sans Regular']) {
    for (const sz of [7, 9, 10, 11, 12, 18, 24, 32]) {
      const font = { name, sz, ...style }, mdw = Math.max(1, Math.round(sz * 4 / 3 * em));
      expect(xlsxMaximumDigitWidth(font)).toBe(mdw);
      for (const width of [2.25, 12.5, 27.75]) {
        expect(xlsxColumnPixels({ width }, font)).toBe(Math.floor((width + Math.floor(128 / mdw) / 256) * mdw));
      }
      const pixels = 157;
      expect(xlsxColumnPixels({ width: xlsxWidthFromPixels(pixels, font) }, font)).toBe(pixels);
    }
  }
});

it('keeps native Regular face names while resolving the bundled family in CSS', () => {
  const key = fontKeyFor('Open Sans Regular');
  expect(fontName(key)).toBe('Open Sans Regular');
  expect(fontStack(key)).toBe('"Open Sans Regular", "Open Sans", Arial, sans-serif');
  expect(xlsxMaximumDigitWidth({ name: 'Open Sans', sz: NaN })).toBeNull();
  expect(xlsxMaximumDigitWidth({ name: 'Open Sans', sz: 0 })).toBeNull();
});

it('serves every declared face locally with its Apache notice', () => {
  const css = fs.readFileSync(new URL('../src/styles/fonts.css', import.meta.url), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(m => m[1]).filter(s => /font-family: 'Open Sans'/.test(s));
  expect(faces).toHaveLength(4);
  for (const face of faces) {
    const path = face.match(/url\('([^']+)'\)/)[1];
    expect(path).toMatch(/^\/fonts\/opensans\/OpenSans-[A-Za-z]+\.ttf$/);
    expect(fs.statSync(new URL(`../public${path}`, import.meta.url)).size).toBeGreaterThan(0);
    expect(face).toContain('font-display: swap');
  }
  const license = fs.readFileSync(new URL('../public/fonts/opensans/LICENSE.txt', import.meta.url), 'utf8');
  expect(license).toContain('Apache License');
  expect(license).toContain('Version 2.0');
});
