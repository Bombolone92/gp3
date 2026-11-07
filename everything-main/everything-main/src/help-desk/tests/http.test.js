// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readBody } from '../src/server/http.js';

function chunked(chunks, onPull) {
  let i = 0;
  const body = new ReadableStream({
    pull(c) {
      onPull?.(i);
      if (i < chunks.length) c.enqueue(new TextEncoder().encode(chunks[i++]));
      else c.close();
    },
  });
  return new Request('https://x/', { method: 'POST', body, duplex: 'half' });
}

describe('readBody', () => {
  it('reads a body under the limit', async () => {
    const bytes = await readBody(new Request('https://x/', { method: 'POST', body: '{"a":1}' }), 100);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
    const parts = await readBody(chunked(['ab', 'cd']), 100);
    expect(new TextDecoder().decode(parts)).toBe('abcd');
  });

  it('refuses a declared length over the limit without reading', async () => {
    const req = new Request('https://x/', { method: 'POST', body: 'x'.repeat(10), headers: { 'content-length': '999' } });
    expect(await readBody(req, 100)).toBeNull();
  });

  it('stops reading a stream with no length once it passes the limit', async () => {
    let pulls = 0;
    const req = chunked(Array(1000).fill('x'.repeat(100)), () => { pulls++; });
    expect(await readBody(req, 1000)).toBeNull();
    expect(pulls).toBeLessThan(20);
  });
});
