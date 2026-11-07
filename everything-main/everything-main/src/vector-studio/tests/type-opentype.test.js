import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import opentype from 'opentype.js';
import { createText } from '../src/model/nodes.js';
import { registerMeasureFont, layoutText, glyphPlacements, drawsAsSegments } from '../src/model/text-layout.js';
import { applyRunStyle } from '../src/model/text-runs.js';
import { registerOutlineFont } from '../src/features/type/fonts.js';
import { installShaping, shapeChars, needsShaping, featureTags, cssFeatureSettings, loadShapingFont, fontFeatures, glyphPath, fontAlternates, glyphChar } from '../src/features/type/shaping.js';
import { textToPathData } from '../src/features/type/outlines.js';

const fonts = {};

function load(pkg, family) {
  const buf = readFileSync(resolve(process.cwd(), `node_modules/@fontsource/${pkg}/files/${pkg}-latin-400-normal.woff`));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  registerMeasureFont(family, 400, 'normal', font);
  registerOutlineFont(family, 400, 'normal', font);
  fonts[family] = font;
  return font;
}

const style = (family, extra = {}) => ({ fontFamily: family, fontWeight: 400, fontStyle: 'normal', fontSize: 100, horizontalScale: 100, verticalScale: 100, tracking: 0, ...extra });
const gid = (family, c) => fonts[family].charToGlyphIndex(c);

beforeAll(async () => {
  load('roboto', 'Roboto');
  load('montserrat', 'Montserrat');
  load('inter', 'Inter');
  load('playfair-display', 'Playfair Display');
  installShaping();
  for (const f of ['Roboto', 'Montserrat', 'Inter', 'Playfair Display']) await loadShapingFont(style(f));
});

describe('which runs shape', () => {
  it('leaves plain type to the canvas and shapes runs with features', () => {
    expect(needsShaping(style('Inter'))).toBe(false);
    expect(needsShaping(style('Inter', { ligatures: true, contextual: true, figures: 'default', otPosition: 'default' }))).toBe(false);
    expect(needsShaping(style('Inter', { ligatures: false }))).toBe(true);
    expect(needsShaping(style('Inter', { stylisticSets: [2] }))).toBe(true);
    expect(needsShaping(style('Inter', { altGlyph: 5 }))).toBe(true);
    expect(featureTags(style('Inter', { stylisticSets: [1, 12], figures: 'tabular-oldstyle' }))).toEqual(expect.arrayContaining(['liga', 'ss01', 'ss12', 'tnum', 'onum']));
    expect(featureTags(style('Inter', { ligatures: false }))).not.toContain('liga');
  });

  it('writes CSS feature settings for export', () => {
    expect(cssFeatureSettings(style('Inter'))).toBe('');
    expect(cssFeatureSettings(style('Inter', { fractions: true, ligatures: false }))).toBe('"liga" 0, "frac" 1');
    expect(cssFeatureSettings(style('Inter', { otPosition: 'sups', stylisticSets: [3] }))).toBe('"ss03" 1, "sups" 1');
  });
});

describe('GSUB substitution', () => {
  it('forms standard ligatures and drops them when turned off', () => {
    const f = fonts.Roboto;
    const on = shapeChars(f, [...'fit'], style('Roboto', { swash: true }));
    expect(on).toHaveLength(2);
    expect(on[0].n).toBe(2);
    expect(on[0].g).not.toBe(gid('Roboto', 'f'));
    const off = shapeChars(f, [...'fit'], style('Roboto', { ligatures: false }));
    expect(off.map((i) => i.g)).toEqual([...'fit'].map((c) => gid('Roboto', c)));
  });

  it('builds fractions only around the slash', () => {
    const f = fonts.Montserrat;
    const items = shapeChars(f, [...'1/2 of 2024'], style('Montserrat', { fractions: true }));
    const g = items.map((i) => i.g);
    expect(g[0]).not.toBe(gid('Montserrat', '1')); // numerator
    expect(g[1]).not.toBe(gid('Montserrat', '/')); // fraction slash
    expect(g[2]).not.toBe(gid('Montserrat', '2')); // denominator
    expect(g[2]).not.toBe(g[0] + (gid('Montserrat', '2') - gid('Montserrat', '1'))); // not a numerator
    // Digits away from a slash stay as they are.
    expect(g.slice(7)).toEqual([...'2024'].map((c) => gid('Montserrat', c)));
  });

  it('switches figure styles', () => {
    const tab = shapeChars(fonts.Inter, [...'1'], style('Inter', { figures: 'tabular-lining' }));
    expect(tab[0].g).not.toBe(gid('Inter', '1'));
    const lin = shapeChars(fonts['Playfair Display'], [...'1'], style('Playfair Display', { figures: 'proportional-lining' }));
    expect(lin[0].g).not.toBe(gid('Playfair Display', '1'));
  });

  it('uses an explicit glyph alternate only where it belongs to the character', () => {
    const one = gid('Inter', '1');
    const alt = fontAlternates(fonts.Inter).alts.get(one)[0].glyph;
    expect(shapeChars(fonts.Inter, [...'1'], style('Inter', { altGlyph: alt }))[0].g).toBe(alt);
    // The same glyph index on another character (or in another font) is ignored.
    expect(shapeChars(fonts.Inter, [...'a'], style('Inter', { altGlyph: alt }))[0].g).toBe(gid('Inter', 'a'));
    expect(glyphChar(fonts.Inter, alt)).toBe('1');
  });

  it('reports the features a font has', () => {
    expect(fontFeatures(fonts.Montserrat).has('frac')).toBe(true);
    expect(fontFeatures(fonts.Montserrat).has('ss01')).toBe(false);
  });
});

describe('layout and output', () => {
  it('lays out shaped runs with substituted glyphs and absorbed characters', () => {
    let n = createText('fit fit', 0, 100, { char: { ...style('Roboto') } });
    n = { ...n, runs: applyRunStyle(n, 0, 3, { ligatures: true, discretionary: true }) };
    const lay = layoutText(n);
    expect(lay.chars.shaped).toBe(true);
    expect(drawsAsSegments(lay)).toBe(false);
    expect(lay.chars.glyph[1]).toBe(-1);
    expect(lay.chars.adv[1]).toBe(0);
    const gs = glyphPlacements(lay);
    expect(gs[0].ch).toBe('fi');
    expect(gs[0].glyph).toBeGreaterThan(0);
    // The second word is plain: drawn as characters.
    expect(gs.filter((g) => g.i >= 4).every((g) => g.glyph == null)).toBe(true);
    // Ligature advance is the ligature glyph's own width.
    const lig = fonts.Roboto.glyphs.get(lay.chars.glyph[0]);
    expect(lay.chars.adv[0]).toBeCloseTo((lig.advanceWidth * 100) / fonts.Roboto.unitsPerEm, 5);
  });

  it('builds glyph paths for drawing', () => {
    const p = glyphPath(style('Roboto'), gid('Roboto', 'H'), 50);
    expect(p).toBeTruthy();
    expect(p.ops.length).toBeGreaterThan(4);
    expect(glyphPath(style('Roboto'), gid('Roboto', 'H'), 50)).toBe(p);
  });

  it('creates outlines from substituted glyphs', async () => {
    const n = createText('1/2', 0, 100, { char: { ...style('Montserrat'), fractions: true } });
    const out = await textToPathData(n);
    const plain = await textToPathData(createText('1/2', 0, 100, { char: { ...style('Montserrat') } }));
    expect(out).toHaveLength(3);
    const h = (gs) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of gs[0].contours) for (const a of c.anchors) {
        lo = Math.min(lo, a.y);
        hi = Math.max(hi, a.y);
      }
      return hi - lo;
    };
    // The numerator is a smaller figure than the plain one.
    expect(h(out)).toBeLessThan(h(plain) * 0.8);
  });
});
