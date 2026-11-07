import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutGposOnlyKerning } from '../src/engine/gpos-only-kerning-font.js';
const original = () => new Uint8Array(readFileSync('public/fonts/BebasNeue-Regular.ttf')).buffer;
function tables(buffer) {
  const view = new DataView(buffer), result = new Map();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16, name = String.fromCharCode(...new Uint8Array(buffer, at, 4));
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    result.set(name, { at, offset, length, bytes: new Uint8Array(buffer, offset, length) });
  }
  return result;
}
function features(buffer) {
  const t = tables(buffer).get('GPOS'), v = new DataView(buffer, t.offset, t.length), start = v.getUint16(6);
  return Array.from({ length: v.getUint16(start) }, (_, i) => {
    const at = start + 2 + i * 6;
    return { tag: v.getUint32(at), at: t.offset + at, target: t.offset + start + v.getUint16(at + 4) };
  });
}
it('disables only kern feature references and preserves outlines, metrics and other positioning bytes', () => {
  const source = original(), before = source.slice(0), result = withoutGposOnlyKerning(source);
  expect(result).not.toBeNull(); expect(source).toEqual(before);
  const a = tables(source), b = tables(result);
  expect(b.has('DSIG')).toBe(false);
  for (const [name, table] of a) if (!['head', 'GPOS', 'DSIG'].includes(name)) expect(b.get(name).bytes, name).toEqual(table.bytes);
  const expected = new Uint8Array(a.get('GPOS').bytes), offset = a.get('GPOS').offset;
  for (const f of features(source)) if (f.tag === 0x6b65726e) { expected[f.target - offset + 2] = 0; expected[f.target - offset + 3] = 0; }
  expect(b.get('GPOS').bytes).toEqual(expected);
  let checksum = 0; const view = new DataView(result);
  for (let i = 0; i < result.byteLength; i += 4) checksum = (checksum + view.getUint32(i)) >>> 0;
  expect(checksum).toBe(0xb1b0afba);
  expect(withoutGposOnlyKerning(result)).toBeNull();
});
it.each(['OpenSans.ttf', 'OpenSans-Italic.ttf'])('leaves variable %s untouched', file => {
  const buffer = new Uint8Array(readFileSync('public/fonts/' + file)).buffer;
  expect(withoutGposOnlyKerning(buffer)).toBeNull();
});
it('rejects legacy-table fonts instead of losing their pairs', () => {
  const buffer = original(), table = tables(buffer).get('DSIG');
  new Uint8Array(buffer, table.at, 4).set(new TextEncoder().encode('kern'));
  expect(withoutGposOnlyKerning(buffer)).toBeNull();
});
it.each(['offset', 'count', 'lookup', 'parameters'])('rejects malformed kern feature %s atomically', kind => {
  const buffer = original(), f = features(buffer).find(f => f.tag === 0x6b65726e), view = new DataView(buffer);
  if (kind === 'offset') view.setUint16(f.at + 4, 65535);
  if (kind === 'count') view.setUint16(f.target + 2, 65535);
  if (kind === 'lookup') view.setUint16(f.target + 4, 65535);
  if (kind === 'parameters') view.setUint16(f.target, 1);
  const before = buffer.slice(0); expect(withoutGposOnlyKerning(buffer)).toBeNull(); expect(buffer).toEqual(before);
});
it('rejects truncated data', () => {
  for (const size of [0, 12, 100, 500]) expect(withoutGposOnlyKerning(original().slice(0, size))).toBeNull();
});
