import { expect, it } from 'vitest';
import { Font, Glyph, Path, parse } from '../src/vendor/opentype/opentype.mjs';
import { literalSeparatorFont, LITERAL_SEPARATOR_ALIAS } from '../src/engine/literal-separator-font.js';

function fixture({ supplementary = false, separator = true, occupiedAlias = false } = {}) {
  const path = new Path(); path.moveTo(0, 0); path.lineTo(600, 0); path.lineTo(300, 700); path.close();
  const glyphs = [new Glyph({ name: '.notdef', advanceWidth: 500, path: new Path() }),
    new Glyph({ name: 'space', unicode: 32, advanceWidth: 250, path: new Path() }),
    new Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path })];
  if (separator) glyphs.push(new Glyph({ name: 'separator', unicode: 0x2028, advanceWidth: 900, path }));
  if (supplementary) glyphs.push(new Glyph({ name: 'supplementary', unicode: 0x10000, advanceWidth: 650, path }));
  if (occupiedAlias) glyphs.push(new Glyph({ name: 'occupied', unicode: 0xffff, advanceWidth: 100, path }));
  return new Font({ familyName: 'Original Separator Control', styleName: 'Regular', unitsPerEm: 1000,
    ascender: 800, descender: -200, glyphs }).toArrayBuffer();
}
function tables(buffer) {
  const v = new DataView(buffer), result = new Map();
  for (let i = 0; i < v.getUint16(4); i++) {
    const at = 12 + i * 16, tag = String.fromCharCode(...new Uint8Array(buffer, at, 4));
    result.set(tag, new Uint8Array(buffer.slice(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12))));
  }
  return result;
}
for (const supplementary of [false, true]) it(`preserves every original mapping and non-cmap table (${supplementary ? 'format 12' : 'format 4'})`, () => {
  const source = fixture({ supplementary }), before = source.slice(0), original = parse(source);
  const derived = literalSeparatorFont(source); expect(derived).not.toBeNull(); expect(source).toEqual(before);
  const mapped = parse(derived), oldTables = tables(source), newTables = tables(derived);
  for (const [cp, glyph] of Object.entries(original.tables.cmap.glyphIndexMap)) expect(mapped.tables.cmap.glyphIndexMap[cp]).toBe(glyph);
  expect(mapped.charToGlyphIndex(LITERAL_SEPARATOR_ALIAS)).toBe(original.charToGlyphIndex('\u2028'));
  expect(mapped.charToGlyph(LITERAL_SEPARATOR_ALIAS).advanceWidth).toBe(900);
  expect(mapped.charToGlyph(LITERAL_SEPARATOR_ALIAS).path.commands).toEqual(original.charToGlyph('\u2028').path.commands);
  for (const [tag, bytes] of oldTables) {
    if (tag === 'cmap' || tag === 'DSIG') continue;
    const actual = newTables.get(tag).slice(), expected = bytes.slice();
    if (tag === 'head') { actual.fill(0, 8, 12); expected.fill(0, 8, 12); }
    expect(actual, tag).toEqual(expected);
  }
  const view = new DataView(derived); let sum = 0;
  for (let i = 0; i < derived.byteLength; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  expect(sum).toBe(0xb1b0afba);
});
it('declines missing glyphs, alias collisions, truncated fonts and unsupported containers', () => {
  for (const source of [fixture({ separator: false }), fixture({ occupiedAlias: true }), fixture().slice(0, 32), new ArrayBuffer(0)]) {
    const before = source.slice(0); expect(literalSeparatorFont(source)).toBeNull(); expect(source).toEqual(before);
  }
});
