import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';

const tick = () => new Promise(setImmediate);

/** The prompt an AI-backed formula sends, recorded by a provider that answers "ok". */
async function promptOf(formula, fill, name = 'AI') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const seen = [];
  wb.setAsyncProvider(name, async (text) => { seen.push(text); return 'ok'; });
  fill(wb, id);
  wb.setInput(id, 99, 25, `=${formula}`);
  expect(wb.getValue(id, 99, 25)).toEqual({ error: '#BUSY!' });
  await tick();
  expect(wb.getValue(id, 99, 25)).toBe('ok');
  return seen[0];
}

// AI(prompt, data) wrote each cell with String(): a date as its serial, 0.1+0.2 with its float noise,
// TRUE as "true", a sparkline as "[object Object]", and a whole sheet at once; TRANSLATE passed
// Sheets' "auto" source language on as the name of a language. Since the workbook offers a range's
// display text, a date reads as the sheet shows it and $1,000 keeps its currency format.
describe('AI() data', () => {
  it('is written as the cells show, drawables left out', async () => {
    const prompt = await promptOf('AI("describe", A1:C4)', (wb, id) => {
      const rows = [['When', 'Amt', 'Ok'], ['2026-01-05', '=0.1+0.2', 'TRUE'], ['=NA()', '$1,000', 'two\nlines'], ['=SPARKLINE({1,2})', '', 'lbl']];
      rows.forEach((row, r) => row.forEach((text, c) => { if (text !== '') wb.setInput(id, r, c, text); }));
    });
    expect(prompt).toBe('describe\n\nData:\nWhen\tAmt\tOk\n2026-01-05\t0.3\tTRUE\n#N/A\t$1,000\ttwo lines\n\t\tlbl');
  });

  it('is cut to sixty rows and fifteen columns with a note of what is left out', async () => {
    const prompt = await promptOf('AI("summarize", A1:Z200)', (wb, id) => {
      const cells = [];
      for (let r = 0; r < 70; r++) for (let c = 0; c < 20; c++) cells.push({ r, c, cell: { v: r * 100 + c, f: null } });
      wb.setCells(id, cells);
    });
    const lines = prompt.split('\n');
    expect(lines.slice(0, 3)).toEqual(['summarize', '', 'Data:']);
    expect(lines[3]).toBe(Array.from({ length: 15 }, (_, c) => String(c)).join('\t'));
    expect(lines[62]).toBe(Array.from({ length: 15 }, (_, c) => String(5900 + c)).join('\t'));
    expect(lines[63]).toBe('(140 more rows and 11 more columns not shown)');
    expect(lines).toHaveLength(64);
  });

  it('reads the cells as they are shown when the workbook offers their display text', () => {
    const data = { range: true, values: [['When', 'Amt'], [46027, 0.5208333333333334], [{ sparkline: true }, null]], ref: { kind: 'range', r1: 0, c1: 0, r2: 2, c2: 1 } };
    const ctx = { asyncValue: (name, text) => text, getRangeDisplay: (ref) => (ref === data.ref ? [['When', 'Amt'], ['2026-01-05', '12:30'], ['', '']] : null) };
    expect(FUNCTIONS.AI.fn(['describe', data], ctx)).toBe('describe\n\nData:\nWhen\tAmt\n2026-01-05\t12:30\n\t');
    // Without it, a date is its serial and a time its fraction of a day, in General's eleven-character display.
    expect(FUNCTIONS.AI.fn(['describe', data], { asyncValue: ctx.asyncValue })).toBe('describe\n\nData:\nWhen\tAmt\n46027\t0.520833333\n\t');
  });
});

describe('TRANSLATE()', () => {
  it('treats a source language of auto as none given', async () => {
    const auto = await promptOf('TRANSLATE("hola","auto","en")', () => {}, 'TRANSLATE');
    expect(auto).toContain('from the language it is written in to en');
    const upper = await promptOf('TRANSLATE("hola","AUTO")', () => {}, 'TRANSLATE');
    expect(upper).toContain('from the language it is written in to English');
    const given = await promptOf('TRANSLATE("hola","es","en")', () => {}, 'TRANSLATE');
    expect(given).toContain('from es to en');
  });
});
