import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { FUNCTIONS, EMPTY } from '../src/core/formula/functions.js';

// TRANSLATE(text, from, ) hands the function the evaluator's empty marker for its target, which
// the check for a missing target did not see, so the prompt asked for a translation "to ." with
// no language named. The hint promises English; an empty or blank target now asks for it.
describe('TRANSLATE with an empty target', () => {
  const prompt = (args) => FUNCTIONS.TRANSLATE.fn(args, { asyncValue: (kind, text) => text });

  it('asks for English for an empty, blank or omitted target and names any other', () => {
    expect(prompt(['hola', 'es', EMPTY])).toContain('from es to English.');
    expect(prompt(['hola', EMPTY, EMPTY])).toContain('from the language it is written in to English.');
    expect(prompt(['hola', 'es', '  '])).toContain('from es to English.');
    expect(prompt(['hola', 'es', ''])).toContain('from es to English.');
    expect(prompt(['hola', 'es'])).toContain('from es to English.');
    expect(prompt(['hola', 'es', 'de'])).toContain('from es to de.');
    expect(prompt(['hola', 'es', EMPTY])).not.toContain(' to .');
  });

  it('reaches the provider with English from a formula whose target slot is empty', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const asked = [];
    wb.setAsyncProvider('TRANSLATE', async (text) => { asked.push(text); return 'hello'; });
    const set = (a1, f) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, f); return wb.getValue(id, r, c); };
    expect(set('A1', '=TRANSLATE("hola","es",)')).toEqual({ error: '#BUSY!' });
    set('A2', '=GOOGLETRANSLATE("hola",,)');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('from es to English.');
    expect(asked[1]).toContain('from the language it is written in to English.');
    expect(asked.some((t) => t.includes(' to .'))).toBe(false);
  });
});
