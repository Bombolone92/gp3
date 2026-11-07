import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fontSlot } from '../src/engine/font-families.js';

const root = 'tests/fixtures/line-separator-slots/';
const cases = JSON.parse(readFileSync(root + 'cases.json', 'utf8'));
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));

it('binds actual native separator font observations to the original slot/language controls', () => {
  for (const [name, hash] of Object.entries(reference.sha256)) {
    expect(createHash('sha256').update(readFileSync(root + name)).digest('hex'), name).toBe(hash);
  }
  expect(reference.pages).toBe(20);
  expect(reference.rows.map(r => r.case)).toEqual(cases.map(c => c.label));
  for (const row of reference.rows) expect(row.separator.size).toBe(9);
});

it('distinguishes native glyph fallback from the supported OOXML slot classification', () => {
  const expectedFonts = [
    'MS-Gothic', 'MS-Gothic', 'MS-Gothic', 'MS-Gothic',
    'MS Mincho', 'MS-Gothic', 'MS-Gothic', 'MS Mincho',
    'MS-Gothic', 'MS-Gothic', 'MS-Gothic', 'MS-Gothic',
    'MS Mincho', 'MS Mincho', 'MS Mincho', 'MS Mincho',
    'TimesNewRomanPSMT', 'TimesNewRomanPSMT', 'MS Mincho', 'TimesNewRomanPSMT',
  ];
  expect(reference.rows.map(r => r.separator.font)).toEqual(expectedFonts);
  for (const [i, c] of cases.entries()) {
    const style = { fontAscii: c.ascii, fontHAnsi: c.hAnsi, fontEastAsia: c.eastAsia,
      fontCs: c.cs, fontHint: c.hint, fontEastAsiaLanguage: c.language || '', cs: c.complexScript || false };
    const expectedSlot = c.complexScript ? 'fontCs' : i === 2 || i === 6 ? 'fontAscii' : c.hint === 'eastAsia' ? 'fontEastAsia' : 'fontHAnsi';
    expect(fontSlot('\u2028', style), c.label).toBe(expectedSlot);
  }
  for (let i = 8; i < 12; i++) expect(reference.rows[i].baselines).toEqual(reference.rows[0].baselines);
  for (let i = 12; i < 16; i++) expect(reference.rows[i].baselines).toEqual(reference.rows[4].baselines);
});
