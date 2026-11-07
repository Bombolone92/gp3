import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createProofing } from '../src/views/proofing.js';
import { proofingFingerprint } from '../src/engine/docx-proofing-cache.js';
import { loadSpeller } from '../src/lib/spelling.js';

vi.mock('../src/lib/spelling.js', async importOriginal => ({ ...await importOriginal(), loadSpeller: vi.fn(async () => ({ correct: word => word !== 'jumpd', suggest: () => ['jumped'], add() {} })) }));
let dom, proofing;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  dom = new JSDOM('', { url: 'https://example.test' });
  for (const key of ['document', 'Node', 'localStorage']) globalThis[key] = dom.window[key];
});
afterEach(() => { proofing?.destroy(); proofing = null; vi.useRealTimers(); dom.window.close(); for (const key of ['document', 'Node', 'localStorage']) delete globalThis[key]; });
function setup(ranges = []) {
  const body = { revision: 0, text: 'jumpd', paragraphs: [{ runs: [{ text: 'jumpd', fontLanguage: 'en-US' }] }] };
  const saved = { text: body.text, fingerprint: proofingFingerprint(body.paragraphs), ranges };
  const engine = { session: { body, path: null }, model: { range: [0, 0] }, overlays: [], paint: vi.fn() };
  proofing = createProofing({ editor: () => engine, pkg: () => ({ savedSpelling: saved }) });
  proofing.attach(engine); return body;
}
it('uses an empty completed cache without loading the dictionary and rechecks after an edit', async () => {
  const body = setup(); await vi.runAllTimersAsync();
  expect(loadSpeller).not.toHaveBeenCalled(); expect(proofing.summary.errors).toBe(0);
  body.text = 'jumpd more'; body.paragraphs[0].runs[0].text = body.text; body.revision++;
  proofing.changed(); await vi.runAllTimersAsync(); expect(loadSpeller).toHaveBeenCalledOnce(); expect(proofing.summary.errors).toBe(1);
});
it('checks a cached partial range and explicit recheck checks the entire body', async () => {
  setup([{ start: 0, end: 3 }]); await vi.runAllTimersAsync(); expect(proofing.summary.errors).toBe(1);
  proofing.destroy(); setup(); await vi.runAllTimersAsync(); expect(proofing.summary.errors).toBe(0);
  proofing.recheck(); await vi.runAllTimersAsync(); expect(proofing.summary.errors).toBe(1);
});
it('invalidates saved results for proofing-scope changes with unchanged text', async () => {
  const body = setup(); await vi.runAllTimersAsync();
  // Shared style propagation can change body scope while another story owns
  // the edit/revision. The editor still announces the change to proofing.
  body.paragraphs[0].runs[0].fontLanguage = 'en-AU';
  proofing.changed(); await vi.runAllTimersAsync(); expect(proofing.summary.errors).toBe(1);
  body.paragraphs[0].runs[0].noProof = true; body.revision++;
  proofing.changed(); await vi.runAllTimersAsync(); expect(proofing.summary.errors).toBe(0);
});
