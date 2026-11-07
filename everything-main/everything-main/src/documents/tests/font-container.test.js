import {it, expect, vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {normalizeFontBuffer} from '../src/engine/font-container.js';
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {readFontFileInfo} from '../src/engine/font-file-info.js';
import {syntheticAdvanceFont} from '../src/engine/synthetic-advance-font.js';
import {withoutGposOnlyKerning} from '../src/engine/gpos-only-kerning-font.js';
import {withoutLegacyKerning, legacyKerningAsPositioning, repairLegacyKerning} from '../src/engine/legacy-kerning-font.js';
import {literalSeparatorFont} from '../src/engine/literal-separator-font.js';

const file = name => new Uint8Array(readFileSync(`tests/fixtures/woff-controls/${name}`)).buffer;
for (const name of ['legacy', 'positioning', 'optional', 'cff']) {
  it(`restores every ${name} table byte using the independent FontTools oracle`, () => {
    const packed = file(`${name}.woff`), original = packed.slice(0), sfnt = file(`${name}-decoded.ttf`);
    expect(normalizeFontBuffer(packed)).toEqual(sfnt);
    expect(normalizeFontBuffer(packed)).toBe(normalizeFontBuffer(packed));
    expect(normalizeFontBuffer(sfnt)).toBe(sfnt);
    expect(readFontFileInfo(packed)).toEqual(readFontFileInfo(sfnt));
    for (const transform of [syntheticAdvanceFont, withoutGposOnlyKerning, withoutLegacyKerning,
      legacyKerningAsPositioning, repairLegacyKerning, literalSeparatorFont]) {
      expect(transform(packed)).toEqual(transform(sfnt));
    }
    expect(syntheticAdvanceFont(packed)).not.toBeNull();
    expect(literalSeparatorFont(packed)).not.toBeNull();
    if (name === 'legacy') expect(legacyKerningAsPositioning(packed)).not.toBeNull();
    if (name === 'positioning') expect(withoutGposOnlyKerning(packed)).not.toBeNull();
    expect(packed).toEqual(original);
  });
}
const damaged = mutate => {const buffer = file('legacy.woff'); mutate(new DataView(buffer), new Uint8Array(buffer)); return buffer;};
for (const [name, mutate] of Object.entries({
  'reserved header': v => v.setUint16(14, 1),
  'wrong file length': v => v.setUint32(8, v.byteLength - 1),
  'zero table count': v => v.setUint16(12, 0),
  'excessive SFNT allocation': v => v.setUint32(16, 0x4000000),
  'wrong SFNT length': v => v.setUint32(16, v.getUint32(16) + 4),
  'misaligned offset': v => v.setUint32(48, v.getUint32(48) + 1),
  'duplicate tags': v => v.setUint32(64, v.getUint32(44)),
  'table overlap': v => v.setUint32(68, v.getUint32(48)),
  'out of range table': v => v.setUint32(48, v.byteLength + 4),
  'compressed length greater than original': v => v.setUint32(52, v.getUint32(56) + 1),
  'wrong table checksum': v => v.setUint32(60, v.getUint32(60) ^ 1),
  'absent metadata with length': v => v.setUint32(28, 1),
  'absent private block with length': v => v.setUint32(40, 1),
  'corrupt compressed table': (v, bytes) => {
    for (let at = 44; at < 44 + v.getUint16(12) * 20; at += 20) if (v.getUint32(at + 8) < v.getUint32(at + 12)) {
      bytes[v.getUint32(at + 4)] = 0; return;
    }
    throw Error('Control must have compressed tables');
  },
  'nonzero alignment padding': (v, bytes) => {
    for (let at = 44; at < 44 + v.getUint16(12) * 20; at += 20) {
      const length = v.getUint32(at + 8);
      if (length % 4) {bytes[v.getUint32(at + 4) + length] = 1; return;}
    }
    throw Error('Control must have padding');
  },
  'wrong zlib checksum': (v, bytes) => {
    for (let at = 44; at < 44 + v.getUint16(12) * 20; at += 20) if (v.getUint32(at + 8) < v.getUint32(at + 12)) {
      bytes[v.getUint32(at + 4) + v.getUint32(at + 8) - 1] ^= 1; return;
    }
    throw Error('Control must have compressed tables');
  },
})) it(`rejects ${name} without exposing font metadata`, () => {
  const buffer = damaged(mutate), before = buffer.slice(0);
  expect(normalizeFontBuffer(buffer)).toBeNull(); expect(readFontMetadata(buffer)).toBeNull();
  expect(() => readFontFileInfo(buffer)).toThrow(); expect(buffer).toEqual(before);
});
it('ignores invalid optional metadata contents without losing font tables', () => {
  const buffer = file('optional.woff'), view = new DataView(buffer);
  new Uint8Array(buffer)[view.getUint32(24)] = 0;
  expect(normalizeFontBuffer(buffer)).toEqual(file('optional-decoded.ttf'));
});
it('rejects truncated WOFF containers', () => {
  const buffer = file('legacy.woff');
  for (const n of [4, 12, 43, 64, buffer.byteLength - 1]) expect(normalizeFontBuffer(buffer.slice(0,n))).toBeNull();
});
it('keeps compressed SVG sources while reading native baseline metrics from their decoded tables', async () => {
  const dom = new JSDOM(), packed = file('optional.woff'), before = packed.slice(0);
  vi.stubGlobal('DOMParser', dom.window.DOMParser); vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
  try {
    const {metafileFileFonts} = await import('../src/engine/metafile-file-fonts.js');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="&quot;Original WOFF Control&quot;" font-size="20" dominant-baseline="text-before-edge"><tspan x="10" y="10">AV</tspan></text></svg>';
    const result = metafileFileFonts(svg, [['Original WOFF Control']], new Map([['Original WOFF Control',
      {alias:'original woff svg',faces:[{buffer:packed,descriptors:{weight:'300'}}]}]]));
    const parsed = new dom.window.DOMParser().parseFromString(result,'application/xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('text').getAttribute('dominant-baseline')).toBe('alphabetic');
    expect(parsed.querySelector('tspan').getAttribute('y')).toBe('26');
    expect(parsed.querySelector('style').textContent).toContain('data:font/woff;base64,');
    expect(packed).toEqual(before);
  } finally {vi.unstubAllGlobals(); dom.window.close();}
});
