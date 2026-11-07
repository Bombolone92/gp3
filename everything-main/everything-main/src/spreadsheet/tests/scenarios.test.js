import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { saveScenario, deleteScenario, showScenario, mergeScenarios, createScenarioSummary, parseChangingCells, cellsText,
  scenariosXml, parseScenariosXml } from '../src/core/scenarios.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '10'); // B1
  wb.setInput(id, 1, 1, '20'); // B2
  wb.setInput(id, 2, 1, '=B1*B2'); // B3
  return { wb, id };
}
const sheetXml = async (wb, n = 1) => {
  const blob = await workbookToXlsx(wb);
  const zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  return new TextDecoder().decode(X.CFB.find(zip, `/xl/worksheets/sheet${n}.xml`).content);
};

describe('Scenario Manager', () => {
  it('adds, edits, shows and deletes scenarios as undoable steps', () => {
    const { wb, id } = book();
    expect(saveScenario(wb, id, { name: 'Best', cells: parseChangingCells('B1:B2'), values: [12, 30], comment: 'Upside' })).toBe(null);
    expect(saveScenario(wb, id, { name: 'best', cells: parseChangingCells('B1'), values: [1] })).toMatch(/already exists/);
    expect(saveScenario(wb, id, { name: 'Worst', cells: parseChangingCells('$B$1,$B$2'), values: [5, 6] })).toBe(null);
    expect(wb.sheet(id).scenarios.list.map((s) => s.name)).toEqual(['Best', 'Worst']);
    expect(cellsText(wb.sheet(id).scenarios.list[0].cells)).toBe('$B$1:$B$2');
    showScenario(wb, id, 'Best');
    expect(wb.getValue(id, 2, 1)).toBe(360);
    wb.undo();
    expect(wb.getValue(id, 2, 1)).toBe(200);
    expect(saveScenario(wb, id, { name: 'Worst case', cells: parseChangingCells('B1'), values: [1] }, 'Worst')).toBe(null);
    expect(wb.sheet(id).scenarios.list[1].name).toBe('Worst case');
    deleteScenario(wb, id, 'Worst case');
    expect(wb.sheet(id).scenarios.list).toHaveLength(1);
    wb.undo();
    expect(wb.sheet(id).scenarios.list).toHaveLength(2);
  });

  it('moves changing cells when rows and columns are inserted or deleted', () => {
    const { wb, id } = book();
    saveScenario(wb, id, { name: 'A', cells: parseChangingCells('B1:B2'), values: [1, 2] });
    wb.insertRows(id, 0, 2);
    expect(cellsText(wb.sheet(id).scenarios.list[0].cells)).toBe('$B$3:$B$4');
    wb.insertCols(id, 0, 1);
    expect(cellsText(wb.sheet(id).scenarios.list[0].cells)).toBe('$C$3:$C$4');
    wb.deleteRows(id, 2, 1);
    expect(cellsText(wb.sheet(id).scenarios.list[0].cells)).toBe('$C$3');
    expect(wb.sheet(id).scenarios.list[0].values).toEqual([2]);
    wb.undo();
    expect(cellsText(wb.sheet(id).scenarios.list[0].cells)).toBe('$C$3:$C$4');
  });

  it('merges scenarios from another sheet and writes a summary sheet', () => {
    const { wb, id } = book();
    saveScenario(wb, id, { name: 'Best', cells: parseChangingCells('B1:B2'), values: [12, 30] });
    const other = wb.addSheet('Other');
    saveScenario(wb, other.id, { name: 'Best', cells: parseChangingCells('B1'), values: [2] });
    expect(mergeScenarios(wb, id, other.id)).toBe(1);
    expect(wb.sheet(id).scenarios.list.map((s) => s.name)).toEqual(['Best', 'Best 2']);
    const out = createScenarioSummary(wb, id, parseChangingCells('B3'));
    const s = out.sheetId;
    expect(wb.sheet(s).name).toBe('Scenario Summary');
    const v = (r, c) => wb.getValue(s, r, c);
    expect(v(2, 4)).toBe('Best');
    expect(v(5, 2)).toBe('$B$1');
    expect([v(5, 3), v(5, 4), v(5, 5)]).toEqual([10, 12, 2]);
    expect([v(6, 3), v(6, 4), v(6, 5)]).toEqual([20, 30, 20]);
    expect(v(7, 1)).toBe('Result Cells:');
    expect([v(8, 3), v(8, 4), v(8, 5)]).toEqual([200, 360, 40]);
    expect(wb.getValue(id, 2, 1)).toBe(200); // the sheet itself is left as it was
  });

  it('round-trips through the worksheet <scenarios> element', async () => {
    const { wb, id } = book();
    saveScenario(wb, id, { name: 'Best & "bright"', cells: parseChangingCells('B1:B2'), values: [12, 'x<y'], comment: 'Line 1', user: 'NJ' });
    saveScenario(wb, id, { name: 'Hidden', cells: parseChangingCells('B2'), values: [3], hidden: true, locked: false });
    const xml = await sheetXml(wb);
    const element = /<scenarios[\s\S]*<\/scenarios>/.exec(xml)[0];
    expect(element).toContain('<scenario name="Best &amp; &quot;bright&quot;" locked="1" count="2" user="NJ" comment="Line 1"><inputCells r="B1" val="12"/><inputCells r="B2" val="x&lt;y"/></scenario>');
    expect(element).toContain('<scenario name="Hidden" hidden="1" count="1">');
    expect(xml.indexOf('<scenarios')).toBeGreaterThan(xml.indexOf('</sheetData>'));
    const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'x.xlsx');
    const list = back.sheets[0].scenarios.list;
    expect(list.map((s) => s.name)).toEqual(['Best & "bright"', 'Hidden']);
    expect(list[0].values).toEqual([12, 'x<y']);
    expect(list[1]).toMatchObject({ hidden: true, locked: false });
  });

  it('reads the file\'s scenarios markup', () => {
    const s = parseScenariosXml('<worksheet><sheetData/><scenarios current="1" show="1" sqref="C10 D1:D2"><scenario name="a" locked="1" count="1" user="u" comment="c"><inputCells r="$A$1" val="5" numFmtId="2"/></scenario><scenario name="b" count="2"><inputCells r="A1" val="7"/><inputCells r="A2" deleted="1" val="0"/></scenario></scenarios></worksheet>');
    expect(s.list).toHaveLength(2);
    expect(s.list[1].cells).toEqual([{ r: 0, c: 0 }]);
    expect(s.current).toBe(1);
    expect(s.results).toEqual([{ r1: 9, c1: 2, r2: 9, c2: 2 }, { r1: 0, c1: 3, r2: 1, c2: 3 }]);
    expect(scenariosXml(null)).toBe('');
  });
});
