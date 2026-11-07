// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import * as P from '../src/lib/puter.js';

// The fetch helpers refuse a response past their size cap with an error the
// editor used to recognise by its wording. It now carries a code, so a server's
// own "too large" message is not mistaken for the cap, and the wording is free to change.
afterEach(() => { delete window.puter; });

const response = (headers, body = 'x') => ({
  ok: true,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});

it('marks a response declared past the cap with code too-large, on both helpers', async () => {
  window.puter = { net: { fetch: async () => response({ 'content-length': String(P.MAX_FETCH_BYTES + 1) }) } };
  await expect(P.fetchBytes('https://example.com/big.bin')).rejects.toMatchObject({ code: 'too-large', message: expect.stringMatching(/^The response from https:\/\/example.com\/big.bin is too large/) });
  await expect(P.fetchText('https://example.com/big.csv')).rejects.toMatchObject({ code: 'too-large' });
});

it('marks a response found past the cap once read the same way, and leaves other failures without the code', async () => {
  window.puter = { net: { fetch: async () => response({}, 'y'.repeat(P.MAX_FETCH_BYTES + 1)) } };
  await expect(P.fetchBytes('https://example.com/big.bin')).rejects.toMatchObject({ code: 'too-large' });
  window.puter = { net: { fetch: async () => ({ ok: false, status: 413, statusText: 'Payload Too Large' }) } };
  const failure = await P.fetchText('https://example.com/x.csv').catch((e) => e);
  expect(failure.code).toBeUndefined();
  expect(failure.message).toBe('Could not fetch https://example.com/x.csv');
});
