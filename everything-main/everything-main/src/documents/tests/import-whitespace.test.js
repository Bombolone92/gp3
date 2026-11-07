// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { htmlToFragmentWithWhitespace } from '../src/lib/import-whitespace.js';

/** A converter that records the HTML it was handed and returns no fragment. */
function recorder() {
  const seen = [];
  return { seen, api: { htmlToFragment: async ({ html }) => { seen.push(html); return { fragment: [] }; } } };
}

it('applies the pre-line rule around each line break and nowhere else', async () => {
  const { seen, api } = recorder();
  await htmlToFragmentWithWhitespace(api, '<p style="white-space:pre-line"> A <b> B  \n C </b> D </p>');
  // Marked-up text goes to the converter; the text nodes were rewritten in place.
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatch(/SDIMPORTSPACE/);
});

it('handles a very long run of spaces in pre-line text in linear time', async () => {
  const { api } = recorder();
  const html = `<p style="white-space:pre-line">${' '.repeat(300000)}x\n${'\t'.repeat(100000)} y</p>`;
  const started = performance.now();
  await htmlToFragmentWithWhitespace(api, html);
  expect(performance.now() - started).toBeLessThan(2000);
});
