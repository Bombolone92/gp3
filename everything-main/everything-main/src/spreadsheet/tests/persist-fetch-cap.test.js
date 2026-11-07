// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fetchText, fetchBytes, MAX_FETCH_BYTES } from '../src/lib/puter.js';

afterEach(() => { delete window.puter; });

const headers = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
/** A body read in chunks, as a Response streams it. */
function streaming(chunks) {
  let i = 0;
  const reader = { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }), cancel: vi.fn(async () => {}) };
  return { body: { getReader: () => reader }, reader };
}
const serve = (response) => { window.puter = { net: { fetch: vi.fn(async () => response) } }; };

// IMPORT* read whatever a web address served, however large, before any cell budget applied.
it('refuses a response declared larger than the cap before reading it', async () => {
  const text = vi.fn();
  serve({ ok: true, headers: headers({ 'content-length': String(MAX_FETCH_BYTES + 1) }), text });
  await expect(fetchText('https://example.com/big.csv')).rejects.toThrow(/too large/i);
  expect(text).not.toHaveBeenCalled();
});

it('stops reading a body that grows past the cap', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const { body, reader } = streaming(Array.from({ length: Math.ceil(MAX_FETCH_BYTES / chunk.length) + 1 }, () => chunk));
  serve({ ok: true, headers: headers({}), body });
  await expect(fetchBytes('https://example.com/big.bin')).rejects.toThrow(/too large/i);
  expect(reader.cancel).toHaveBeenCalled();
});

it('reads a small response whole, whatever shape the fetch gives it', async () => {
  serve({ ok: true, async text() { return 'a,b\n1,2\n'; } }); // as the dev mock answers
  expect(await fetchText('https://example.com/small.csv')).toBe('a,b\n1,2\n');
  expect([...(await fetchBytes('https://example.com/small.csv'))]).toEqual([...new TextEncoder().encode('a,b\n1,2\n')]);
  const bytes = new TextEncoder().encode('héllo, wörld');
  serve({ ok: true, headers: headers({ 'content-length': String(bytes.length) }), ...streaming([bytes.slice(0, 3), bytes.slice(3)]) });
  expect(await fetchText('https://example.com/x')).toBe('héllo, wörld');
  serve({ ok: true, headers: headers({}), async arrayBuffer() { return bytes.buffer; } });
  expect([...(await fetchBytes('https://example.com/x'))]).toEqual([...bytes]);
});

it('still reports a failed request as such', async () => {
  serve({ ok: false, status: 404 });
  await expect(fetchText('https://example.com/missing')).rejects.toThrow(/Could not fetch/);
});
