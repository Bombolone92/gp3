import { expect, it } from 'vitest';
import { bytesFromBase64 } from '../src/lib/bytes.js';

it('decodes base64 to the same bytes the platform does', () => {
  const source = new Uint8Array(70000).map((_, i) => (i * 7919) % 256);
  const base64 = Buffer.from(source).toString('base64');
  expect(bytesFromBase64(base64)).toEqual(source);
  expect(bytesFromBase64('')).toEqual(new Uint8Array(0));
});
