import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// A file from elsewhere may hold any number of =AI(...) cells with prompts of
// its author's choosing. Asking the AI spends the account's quota, so it is
// gated behind the same permission as IMPORT* formulas and web images.
describe('AI formulas behind the outside-content gate', () => {
  it('answers #BLOCKED! until allowed, then asks', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const prompts = [];
    for (const name of ['AI', 'TRANSLATE', 'DETECTLANGUAGE']) wb.setAsyncProvider(name, async (text) => { prompts.push(`${name}:${text.slice(0, 12)}`); return 'answer'; });
    wb.setExternalAllowed(false);
    wb.setInput(id, 0, 0, '=AI("Summarise this")');
    wb.setInput(id, 1, 0, '=TRANSLATE("hello","en","fr")');
    wb.setInput(id, 2, 0, '=DETECTLANGUAGE("bonjour")');
    for (let r = 0; r < 3; r++) expect(wb.getValue(id, r, 0)).toEqual({ error: '#BLOCKED!' });
    await tick();
    expect(prompts).toEqual([]);
    wb.setExternalAllowed(true);
    for (let r = 0; r < 3; r++) wb.getValue(id, r, 0);
    await tick(); await tick();
    expect(prompts).toHaveLength(3);
    for (let r = 0; r < 3; r++) expect(wb.getValue(id, r, 0)).toBe('answer');
  });
});
