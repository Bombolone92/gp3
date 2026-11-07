import { describe, expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { normalizeSplit, splitAtCell, dropSplit, splitPaneXml, splitFromPane, paneName, pxToTwips } from '../src/core/split-panes.js';

const sheetXml = async (blob) => {
  const zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  return new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
};
/** The file as another program would see it: this app's sidecar sheet taken out, so only the XML speaks. */
const withoutSidecar = async (blob) => {
  const zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
};

describe('split pane geometry', () => {
  it('normalizes a split and drops one with no bar', () => {
    expect(normalizeSplit({ x: 120.4, y: 0, r: 2, c: 1 })).toEqual({ x: 120, y: 0, r: 2, c: 1 });
    expect(normalizeSplit({ x: 0, y: 0 })).toBeNull();
    expect(normalizeSplit({ x: -5, y: 'a' })).toBeNull();
    expect(normalizeSplit({ x: 50, y: 40, r: -1, c: 1.5 })).toEqual({ x: 50, y: 40, r: 0, c: 0 });
    expect(normalizeSplit(null)).toBeNull();
  });

  it('splits above and left of the active cell, one way on the first row or column, and in the middle at the corner', () => {
    expect(splitAtCell({ cellX: 192, cellY: 180, width: 800, height: 400 })).toEqual({ x: 192, y: 180 });
    expect(splitAtCell({ cellX: 0, cellY: 180, width: 800, height: 400 })).toEqual({ x: 0, y: 180 });
    expect(splitAtCell({ cellX: 192, cellY: 0, width: 800, height: 400 })).toEqual({ x: 192, y: 0 });
    expect(splitAtCell({ cellX: 0, cellY: 0, width: 800, height: 400, snap: (axis, v) => axis === 'x' ? 384 : 200 })).toEqual({ x: 384, y: 200 });
    // A cell beyond the window (scrolled away) cannot place a bar there.
    expect(splitAtCell({ cellX: 900, cellY: 100, width: 800, height: 400 })).toEqual({ x: 0, y: 100 });
  });

  it('removes a bar dragged to the edge', () => {
    expect(dropSplit(3, 500)).toBe(0);
    expect(dropSplit(497, 500)).toBe(0);
    expect(dropSplit(200.6, 500)).toBe(201);
  });

  it('writes distances in twentieths of a point and names the panes', () => {
    expect(pxToTwips(64)).toBe(960);
    expect(splitPaneXml({ x: 64, y: 40 }, { topLeftCell: 'B3', activePane: 'bottomRight' }))
      .toBe('<pane xSplit="960" ySplit="600" topLeftCell="B3" activePane="bottomRight" state="split"/>');
    expect(splitPaneXml({ x: 0, y: 40 }, { activePane: 'bottomLeft' })).toBe('<pane ySplit="600" activePane="bottomLeft" state="split"/>');
    expect(splitFromPane('960', '600', { r: 1, c: 2 })).toEqual({ x: 64, y: 40, r: 1, c: 2 });
    expect(paneName({ x: 10, y: 10 })).toBe('bottomRight');
    expect(paneName({ x: 10, y: 0 })).toBe('topRight');
    expect(paneName({ x: 0, y: 10 })).toBe('bottomLeft');
    expect(paneName({ x: 10, y: 10 }, { left: true, top: true })).toBe('topLeft');
  });
});

describe('split and freeze in the workbook', () => {
  it('splitting unfreezes, freezing removes the split, and each is one undo step', () => {
    const wb = new Workbook({ sheets: [{ name: 'Data' }] });
    const id = wb.activeSheetId;
    wb.setFrozen(id, 2, 1);
    wb.setSplit(id, { x: 100, y: 60, r: 0, c: 0 });
    let s = wb.sheet(id);
    expect([s.frozenRows, s.frozenCols]).toEqual([0, 0]);
    expect(s.split).toEqual({ x: 100, y: 60, r: 0, c: 0 });
    wb.undo();
    s = wb.sheet(id);
    expect([s.frozenRows, s.frozenCols, s.split]).toEqual([2, 1, undefined]);
    wb.redo();
    wb.setFrozen(id, 1, 0);
    s = wb.sheet(id);
    expect(s.split).toBeUndefined();
    expect(s.frozenRows).toBe(1);
    wb.undo();
    expect(wb.sheet(id).split).toEqual({ x: 100, y: 60, r: 0, c: 0 });
    wb.setSplit(id, null);
    expect(wb.sheet(id).split).toBeUndefined();
  });

  it('keeps the split through the app\'s own save and a sheet copy', () => {
    const wb = new Workbook({ sheets: [{ name: 'Data' }] });
    wb.setSplit(wb.activeSheetId, { x: 80, y: 0, r: 3, c: 0 });
    const back = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(back.sheets[0].split).toEqual({ x: 80, y: 0, r: 3, c: 0 });
  });
});

describe('split windows in XLSX', () => {
  it('writes <pane state="split"> with distances, and both panes\' first cells', async () => {
    const wb = new Workbook({ sheets: [{ name: 'Data' }] });
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setSplit(id, { x: 192, y: 100, r: 2, c: 1 });
    wb.setSheetOrigin(id, { r: 19, c: 4 });
    const xml = await sheetXml(await workbookToXlsx(wb));
    const pane = xml.match(/<pane\b[^>]*>/)[0];
    expect(pane).toMatch(new RegExp(`xSplit="${pxToTwips(192)}"`));
    expect(pane).toMatch(new RegExp(`ySplit="${pxToTwips(100)}"`));
    expect(pane).toMatch(/topLeftCell="E20"/);
    expect(pane).toMatch(/activePane="bottomRight"/);
    expect(pane).toMatch(/state="split"/);
    expect(xml).toMatch(/<sheetView\b[^>]*topLeftCell="B3"/);
    expect(xml).toMatch(/<selection pane="bottomRight"/);
  });

  it('reads another program\'s split back as a split, not as frozen panes, and keeps it through a save', async () => {
    const bytes = otherProgramsXlsx({
      sheetNames: ['Split', 'Rows'],
      sheetXml: {
        Split: { head: '<sheetViews><sheetView workbookViewId="0" topLeftCell="B3"><pane xSplit="2400" ySplit="1200" topLeftCell="C4" activePane="bottomRight" state="split"/><selection pane="bottomRight" activeCell="C4" sqref="C4"/></sheetView></sheetViews>' },
        Rows: { head: '<sheetViews><sheetView workbookViewId="0"><pane ySplit="900" topLeftCell="A30" activePane="bottomLeft"/></sheetView></sheetViews>' },
      },
    });
    const wb = await workbookFromFile(bytes, 'split.xlsx');
    const [split, rows] = wb.sheets;
    expect([split.frozenRows, split.frozenCols]).toEqual([0, 0]);
    expect(split.split).toEqual({ x: 160, y: 80, r: 2, c: 1 });
    expect(split.viewOrigin).toEqual({ r: 3, c: 2 });
    // state defaults to split
    expect(rows.split).toEqual({ x: 0, y: 60, r: 0, c: 0 });
    expect(rows.viewOrigin).toEqual({ r: 29, c: 0 });
    for (const blob of [await workbookToXlsx(wb)]) {
      const back = await workbookFromFile(await withoutSidecar(blob), 'native.xlsx');
      expect(back.sheets[0].split).toEqual({ x: 160, y: 80, r: 2, c: 1 });
      expect(back.sheets[0].viewOrigin).toEqual({ r: 3, c: 2 });
      expect(back.sheets[1].split).toEqual({ x: 0, y: 60, r: 0, c: 0 });
      const own = await workbookFromFile(blob, 'own.xlsx');
      expect(own.sheets[0].split).toEqual({ x: 160, y: 80, r: 2, c: 1 });
    }
  });

  it('writes frozen panes, not the split, when a sheet is frozen', async () => {
    const wb = new Workbook({ sheets: [{ name: 'Data' }] });
    wb.setSplit(wb.activeSheetId, { x: 100, y: 100 });
    wb.setFrozen(wb.activeSheetId, 1, 0);
    const xml = await sheetXml(await workbookToXlsx(wb));
    expect(xml).toMatch(/state="frozen"/);
    expect(xml).not.toMatch(/state="split"/);
  });
});
