import { it, expect } from 'vitest';
import { metadataFont } from './helpers/sfnt-metadata.js';
import { readFontMetadata } from '../src/engine/font-metadata.js';
import { withoutLegacyKerning } from '../src/engine/legacy-kerning-font.js';

function fixture(mutate = () => {}) {
  const source = metadataFont({ legacyKerning: true, glyphPositioning: true });
  const bytes = new Uint8Array(source.byteLength + 28); bytes.set(new Uint8Array(source));
  const view = new DataView(bytes.buffer), record = 12 + 3 * 16, offset = view.getUint32(record + 8);
  view.setUint32(record + 12, 32);
  const gpos = new DataView(bytes.buffer, offset, 32);
  gpos.setUint32(0, 0x10000); gpos.setUint16(4, 10); gpos.setUint16(6, 28); gpos.setUint16(8, 30);
  gpos.setUint16(10, 1); gpos.setUint32(12, 0x6c61746e); gpos.setUint16(16, 8);
  gpos.setUint16(18, 4); gpos.setUint16(24, 65535);
  mutate(gpos); return bytes.buffer;
}
it('recognizes an empty language scaffold and permits legacy-only kerning preparation', () => {
  const source = fixture(), before = source.slice(0);
  expect(readFontMetadata(source)).toMatchObject({ legacyKerning: true, glyphPositioning: false });
  const derived = withoutLegacyKerning(source); expect(derived).not.toBeNull();
  expect(readFontMetadata(derived)).toMatchObject({ legacyKerning: false, glyphPositioning: false });
  expect(source).toEqual(before);
});
it('retains conservative positioning classification for active, unknown or malformed tables', () => {
  for (const change of [v => v.setUint32(0, 0x20000), v => v.setUint16(4, 0), v => v.setUint16(6, 40),
    v => v.setUint16(10, 100), v => v.setUint16(16, 2), v => v.setUint16(18, 30),
    v => v.setUint16(20, 5), v => v.setUint16(22, 1), v => v.setUint16(24, 0),
    v => v.setUint16(26, 1), v => v.setUint16(28, 1), v => v.setUint16(30, 1)]) {
    const source = fixture(change), before = source.slice(0);
    expect(readFontMetadata(source)?.glyphPositioning).toBe(true);
    expect(withoutLegacyKerning(source)).toBeNull(); expect(source).toEqual(before);
  }
});
