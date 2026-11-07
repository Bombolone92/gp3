import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { fontMetrics } from '../src/engine/font-metrics.js';

it('uses the actual bundled fonts’ ascent, descent and underline metrics at every point size', () => {
  for (const name of ['NotoSans.ttf', 'NotoSans-Italic.ttf']) {
    const data = readFileSync(new URL(`../public/fonts/${name}`, import.meta.url));
    const tables = {};
    for (let i = 0; i < data.readUInt16BE(4); i++) {
      const at = 12 + 16 * i;
      tables[data.toString('ascii', at, at + 4)] = data.readUInt32BE(at + 8);
    }
    const units = data.readUInt16BE(tables.head + 18);
    for (const fontSize of [12, 13.5, 24, 72]) {
      const scale = fontSize * 4 / 3 / units;
      const m = fontMetrics({ fontSize });
      expect(m.ascent).toBeCloseTo(data.readInt16BE(tables.hhea + 4) * scale);
      expect(m.descent).toBeCloseTo(-data.readInt16BE(tables.hhea + 6) * scale);
      expect(m.underlineOffset).toBeCloseTo(-data.readInt16BE(tables.post + 8) * scale);
      expect(m.underlineThickness).toBeCloseTo(data.readInt16BE(tables.post + 10) * scale);
    }
  }
});
