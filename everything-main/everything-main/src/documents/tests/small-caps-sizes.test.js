import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { capitalizationParts } from '../src/engine/capitalization.js';
const ref = JSON.parse(readFileSync('tests/fixtures/small-caps-sizes/reference.json', 'utf8'));
it('matches independently exported native reference sizes across three fonts, half-point boundaries and Unicode cases', () => {
  expect(createHash('sha256').update(readFileSync('public/fixtures/small-caps-sizes.docx')).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/small-caps-sizes/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  for (const row of ref.cases) {
    const parts = capitalizationParts('AaBbéΣσЖж9!?', { capitalization: 'smallCaps', fontSize: row.size, fontFamily: row.font });
    const glyphs = parts.flatMap(p => [...p.text].map(c => [c,p.fontSize]));
    expect(glyphs.map(g => g[0]), row.id).toEqual(row.glyphs.map(g => g[0]));
    row.glyphs.forEach(([,size], i) => expect(Math.abs(glyphs[i][1] - size), `${row.id} glyph ${i}`).toBeLessThan(.061));
  }
});
