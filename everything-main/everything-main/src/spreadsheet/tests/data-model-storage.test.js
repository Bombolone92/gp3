import { expect, it } from 'vitest';
import { dataModelBytes, encodeDataModelBytes } from '../src/core/data-model.js';
it.each([1, 2, 3, 24575, 24576, 24577, 70001])('preserves %i arbitrary bytes with bounded browser fallbacks', length => {
  const input = Uint8Array.from({ length }, (_, i) => (i * 197 + 81) % 256), expected = Buffer.from(input).toString('base64');
  const nativeEncoding = encodeDataModelBytes(input);
  expect(nativeEncoding).toBe(expected);
  const descriptor = archive => ({ version: 1, archive, modelXml: '', connectionsXml: '' });
  expect(dataModelBytes(descriptor(nativeEncoding))).toEqual(input);
  // Remove the native base64 methods, as older browsers (and older Node) lack them, whether or
  // not this runtime has them, then put back exactly what was there.
  const saved = [[Uint8Array, 'fromBase64'], [Uint8Array.prototype, 'toBase64']]
    .map(([owner, key]) => [owner, key, Object.getOwnPropertyDescriptor(owner, key)]);
  try {
    for (const [owner, key] of saved) Object.defineProperty(owner, key, { value: undefined, configurable: true, writable: true });
    expect(encodeDataModelBytes(input)).toBe(expected);
    expect(dataModelBytes(descriptor(expected))).toEqual(input);
  } finally {
    for (const [owner, key, d] of saved) { if (d) Object.defineProperty(owner, key, d); else delete owner[key]; }
  }
});
