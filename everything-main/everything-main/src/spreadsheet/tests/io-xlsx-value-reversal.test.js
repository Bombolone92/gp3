import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { bubbleXlsx } from './helpers/xlsx-bubble-fixture.js';
import { chartData } from '../src/core/charts.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const read = part => new TextDecoder().decode(part.content);
function replace(zip, path, fn) {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(fn(read(part))); part.size = part.content.length;
}
async function native(wb, edit = () => {}) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  edit(zip);
  replace(zip, '/xl/workbook.xml', text => text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}
function workbook(type, appearance = {}) {
  return new Workbook({ sheets: [{ name: 'Data', charts: [{ type, secondaryAxis: type === 'combo', anchor: { r: 0, c: 3 },
    range: { r1: 0, c1: 0, r2: 2, c2: 1 }, yMin: -100, yMax: 100,
    sourceRefs: [{ name: 'First', literal: { categories: [1, 2, 3], values: [-60, 30, 80] } },
      ...(type === 'combo' ? [{ name: 'Second', literal: { categories: [1, 2, 3], values: [2, 4, 8] } }] : [])],
    appearance: { axisCrossings: { x: 25, y: 'max', ...(type === 'combo' ? { y2: 'max' } : {}) }, ...appearance },
  }] }] });
}
const axes = xml => [...xml.matchAll(/<c:(catAx|dateAx|valAx)>[\s\S]*?<\/c:\1>/g)].map(m => m[0]);
const flags = ch => [ch.appearance.reverseCategories, ch.appearance.reverseValues, ch.appearance.reverseSecondaryValues];

it.each(['column', 'bar', 'line', 'area', 'scatter', 'combo'])('imports hand-written %s native value orientation and preserves it through two exports', async type => {
  for (const reversePrimary of [false, true]) for (const reverseSecondary of type === 'combo' ? [false, true] : [false]) {
    const source = workbook(type, { dateAxis: type === 'line', reverseCategories: true });
    let wb = await native(source, zip => replace(zip, '/xl/charts/chart1_1.xml', xml => xml.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, axis => {
      const id = +axis.match(/<c:axId val="(\d+)"/)[1];
      return axis.replace(/<c:orientation val="[^"]+"\/>/, `<c:orientation val="${(id === 2 ? reversePrimary : id === 3 ? reverseSecondary : true) ? 'maxMin' : 'minMax'}"/>`);
    })));
    for (let pass = 0; pass < 2; pass++) {
      expect(flags(wb.activeSheet.charts[0])).toEqual([true, reversePrimary, reverseSecondary]);
      wb = await native(wb, zip => {
        const nativeAxes = axes(read(X.CFB.find(zip, '/xl/charts/chart1_1.xml')));
        expect(nativeAxes).toHaveLength(type === 'combo' ? 3 : 2);
        nativeAxes.forEach((axis, i) => expect(axis).toContain(`<c:orientation val="${[true, reversePrimary, reverseSecondary][i] ? 'maxMin' : 'minMax'}"/>`));
      });
    }
    const sheet = wb.activeSheet, ch = sheet.charts[0];
    const before = flags(ch), copy = wb.duplicateChart(sheet.id, ch.id);
    expect(flags(wb.chartById(sheet.id, copy))).toEqual(before);
    wb.undo(); expect(sheet.charts).toHaveLength(1);
    wb.updateChart(sheet.id, ch.id, { appearance: { ...ch.appearance, reverseValues: !reversePrimary } });
    expect(flags(sheet.charts[0])[1]).toBe(!reversePrimary);
    wb.undo(); expect(flags(sheet.charts[0])).toEqual(before);
    const draft = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(flags(draft.activeSheet.charts[0])).toEqual(before);
    expect(draft.activeSheet.charts[0].appearance.axisCrossings.x).toBe(25);
  }
});

it.each(['', 'minMax', 'MAXMIN', 'sideways'])('defaults omitted or malformed native orientation %j to minimum-to-maximum', async orientation => {
  const wb = await native(workbook('combo'), zip => replace(zip, '/xl/charts/chart1_1.xml', xml => xml.replace(/<c:orientation val="[^"]+"\/>/g, orientation ? `<c:orientation val="${orientation}"/>` : '')));
  expect(flags(wb.activeSheet.charts[0])).toEqual([false, false, false]);
});

it('imports bubble value orientation and retains it in editable workbook round trips', async () => {
  let wb = await workbookFromFile(bubbleXlsx({ editChart: xml => xml.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, axis =>
    axis.replace(/<c:scaling>/, '<c:scaling><c:orientation val="maxMin"/>')) }), 'reversed-bubbles.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    expect(wb.activeSheet.charts[0].appearance.reverseValues).toBe(true);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'editable.xlsx');
  }
});

it('keeps linked value edits and undo live on a reversed axis through native export', async () => {
  let wb = new Workbook({ sheets: [{ name: 'Data' }] });
  const sheet = wb.activeSheet;
  [['Name', 'Value'], ['A', '-12'], ['B', '27'], ['C', '51']].forEach((row, r) => row.forEach((value, c) => wb.setInput(sheet.id, r, c, value)));
  wb.addChart(sheet.id, { type: 'column', anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 3, c2: 1 },
    appearance: { reverseValues: true } });
  const values = () => chartData(wb, wb.activeSheetId, wb.activeSheet.charts[0]).series[0].values;
  wb.clearHistory(); wb.setInput(sheet.id, 2, 1, '-36');
  expect(values()).toEqual([-12, -36, 51]);
  wb.undo(); expect(values()).toEqual([-12, 27, 51]);
  wb.redo();
  wb = await native(wb);
  expect(values()).toEqual([-12, -36, 51]);
  expect(wb.activeSheet.charts[0].appearance.reverseValues).toBe(true);
});
