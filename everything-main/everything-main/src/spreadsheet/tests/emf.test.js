import { expect, it } from 'vitest';
import { emfSvg } from '../src/core/emf.js';
import { record, vectorEmf } from './helpers/emf-fixture.js';

it('renders compound polygons and filled cubic paths with GDI mapping, colors and winding', () => {
  const svg = emfSvg(vectorEmf());
  expect(svg).toContain('viewBox="0 0 101 61"');
  expect(svg).toContain('d="M 5 3 L 85 3 L 85 53 L 5 53 Z M 15 13 L 25 13 L 25 23 L 15 23 Z" fill="#112233" fill-rule="evenodd" stroke="none"');
  expect(svg).toContain('d="M 15 8 C 25 8 25 28 35 28 Z" fill="#ffffff"');
  expect(svg).not.toMatch(/NaN|Infinity/);
});

it('rejects unsupported painting or state changes instead of returning partial artwork', () => {
  for (const extra of [record(999), record(17, [7]), record(39, [3, 2, 0, 0]), record(37, [999]), record(62, [0, 0, 0, 0])]) {
    expect(emfSvg(vectorEmf([extra]))).toBeNull();
  }
});

it('bounds malformed records, object tables, point counts and file sizes', () => {
  for (const [offset, value] of [[0, 2], [4, 4], [40, 0], [48, 999999], [52, 50001], [56, 5000], [16, 0x7fffffff]]) {
    const bytes = vectorEmf(); new DataView(bytes.buffer).setUint32(offset, value, true);
    expect(emfSvg(bytes)).toBeNull();
  }
  expect(emfSvg(vectorEmf().subarray(0, 100))).toBeNull();
  expect(emfSvg(new Uint8Array(16 * 1024 * 1024 + 1))).toBeNull();
  expect(emfSvg(vectorEmf([record(88, [0, 0, 1, 1, 0xffffffff])]))).toBeNull();
});
