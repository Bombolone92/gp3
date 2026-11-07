import { describe, it, expect } from 'vitest';
import { updateTocs } from '../src/lib/toc.js';

describe('updateTocs', () => {
  it('refreshes every table of contents and reports the count', async () => {
    const calls = [];
    const api = {
      toc: {
        list: async () => ({ items: [{ address: { kind: 'block', nodeType: 'tableOfContents', nodeId: 'A' } }, { id: 'B' }] }),
        update: async (input) => { calls.push(input); return { success: true }; },
      },
    };
    expect(await updateTocs(api)).toBe(2);
    expect(calls).toEqual([
      { target: { kind: 'block', nodeType: 'tableOfContents', nodeId: 'A' }, mode: 'all' },
      { target: { kind: 'block', nodeType: 'tableOfContents', nodeId: 'B' }, mode: 'all' },
    ]);
  });

  it('returns zero without a table of contents and throws on failure', async () => {
    expect(await updateTocs({ toc: { list: async () => ({ items: [] }), update: async () => ({ success: true }) } })).toBe(0);
    const api = { toc: { list: async () => ({ items: [{ id: 'A' }] }), update: async () => ({ success: false, failure: { message: 'stale' } }) } };
    await expect(updateTocs(api)).rejects.toThrow('stale');
  });
});
