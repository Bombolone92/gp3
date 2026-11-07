import { expect } from 'vitest';

// Compare each OPC part as bytes, without recursively walking every byte as an
// object property. Keep both package membership and exact content assertions.
export function assertPackageParts(actual, expected) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, bytes] of Object.entries(expected)) {
    expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
  }
}
