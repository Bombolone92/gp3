// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml } from '../src/core/clipboard.js';
import { sheetToHtml } from '../src/core/io.js';
import { tableStyle } from '../src/core/tables.js';

// A table's coat — its header, totals and band colours — is the base a cell's own fill lies over, as
// the grid draws it; a conditional-format rule's fill lies over both. The conditional
// style marks a coat fill so the HTML written for the clipboard and for a web page can tell the two
// apart without comparing colours.
describe('a table coat under a cell\'s own fill in copied and exported HTML', () => {
  function book() {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Item');
    for (let r = 1; r <= 4; r++) wb.setInput(id, r, 0, `row ${r}`);
    const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
    const table = wb.tableById(id, tid);
    const look = tableStyle(table.style);
    return { wb, id, look };
  }

  it('marks the coat, and drops the mark once a rule paints another fill over it', () => {
    const { wb, id, look } = book();
    // Rows 1 and 3 of the data wear the band; a rule fill replaces the band on row 3.
    expect(wb.conditionalStyle(id, 0, 0, 'Item')).toMatchObject({ bg: look.header, coat: true });
    const banded = [1, 2, 3, 4].filter((r) => wb.conditionalStyle(id, r, 0, `row ${r}`)?.bg === look.band);
    expect(banded.length).toBe(2);
    expect(wb.conditionalStyle(id, banded[0], 0, `row ${banded[0]}`)).toEqual({ bg: look.band, coat: true });
    wb.addRule(id, { type: 'contains', value: `row ${banded[1]}`, range: { r1: 1, c1: 0, r2: 4, c2: 0 }, style: { bg: '#ff0000' } });
    expect(wb.conditionalStyle(id, banded[1], 0, `row ${banded[1]}`)).toEqual({ bg: '#ff0000' });
    // A rule that only sets bold keeps the coat under it.
    wb.addRule(id, { type: 'contains', value: `row ${banded[0]}`, range: { r1: 1, c1: 0, r2: 4, c2: 0 }, style: { bold: true } });
    expect(wb.conditionalStyle(id, banded[0], 0, `row ${banded[0]}`)).toEqual({ bg: look.band, coat: true, bold: true });
  });

  it('writes the cell\'s own fill over the coat, and a rule\'s fill over the own fill', () => {
    const own = { bg: '#00ff00' };
    const coat = { bg: '#dddddd', coat: true };
    const rule = { bg: '#ff0000' };
    const html = cellsToHtml([['a', 'b', 'c']], [[{ v: 'a', s: own }, { v: 'b', s: own }, { v: 'c', s: null }]], [[coat, rule, coat]]);
    const cells = html.match(/<td[^>]*>/g);
    expect(cells[0]).toContain('background-color:#00ff00'); // own fill shows through the coat
    expect(cells[1]).toContain('background-color:#ff0000'); // the rule paints over the own fill
    expect(cells[2]).toContain('background-color:#dddddd'); // no own fill: the coat shows
  });

  it('exports a web page with the own fill of a banded table cell', () => {
    const { wb, id, look } = book();
    const banded = [1, 2, 3, 4].find((r) => wb.conditionalStyle(id, r, 0, `row ${r}`)?.bg === look.band);
    wb.applyStyle(id, { r1: banded, c1: 0, r2: banded, c2: 0 }, { bg: '#123456' });
    const html = sheetToHtml(wb, id);
    const row = html.match(/<td[^>]*>row \d<\/td>/g).find((td) => td.includes(`row ${banded}`));
    expect(row).toContain('background-color:#123456');
    expect(row).not.toContain(look.band);
  });
});
