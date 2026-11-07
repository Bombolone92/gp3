import { test, expect } from '@playwright/test';

// Browsers' decompression streams differ from Node's, so relay decoding is also checked in the browser.
test('decodes a large gzip body with bytes after the end of the stream in full', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(async () => {
    const { decodeContent } = await import('/src/core/http1.js');
    const text = JSON.stringify(Array.from({ length: 40000 }, (_, i) => ({ i, name: `item ${i}`, v: Math.sin(i) })));
    const gz = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const results = [];
    for (const extra of ['\r\n', '', 'junk after the stream']) {
      const body = new Uint8Array([...gz, ...new TextEncoder().encode(extra)]);
      const r = await decodeContent(body, ['gzip']);
      results.push({ same: new TextDecoder().decode(r.body) === text, decoded: r.decoded, error: r.decodeError });
    }
    return results;
  });
  expect(out).toEqual([
    { same: true, decoded: true, error: null },
    { same: true, decoded: true, error: null },
    { same: true, decoded: true, error: null },
  ]);
});
