import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each(['column', 'bar', 'scatter', 'line'])('preserves every tick label position on the %s category/X axis through native round trips and duplication', async type => {
  for (const position of ['nextTo', 'low', 'high', 'none']) {
    let wb = new Workbook({ sheets: [{ name: 'Data', charts: [{ type, anchor: { r: 3, c: 2 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
      sourceRefs: [{ name: 'Values', literal: { categories: [45000, 45001], values: [-25, 10] } }],
      appearance: { xLabelPosition: position, dateAxis: type === 'line', xFormat: type === 'line' ? 'yyyy-mm-dd' : '0',
        xRotation: 45, hideXAxis: false, axisStyles: { x: { color: '#125678', majorTick: 'out' } } },
    }] }] });
    for (let pass = 0; pass < 2; pass++) {
      const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
      const zip = X.CFB.read(bytes, { type: 'array' });
      const text = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
      const kind = type === 'scatter' ? 'valAx' : type === 'line' ? 'dateAx' : 'catAx';
      const axis = text.match(new RegExp(`<c:${kind}>[\\s\\S]*?</c:${kind}>`))[0];
      expect(axis).toContain(`<c:tickLblPos val="${position}"/>`);
      expect(axis).toContain('<c:delete val="0"/>');
      const book = X.CFB.find(zip, '/xl/workbook.xml');
      book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
      book.size = book.content.length;
      wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
      expect(wb.activeSheet.charts[0].appearance).toMatchObject({ xLabelPosition: position, xRotation: 45, hideXAxis: false });
    }
    const sheet = wb.activeSheet, original = sheet.charts[0];
    const copy = wb.duplicateChart(sheet.id, original.id);
    expect(wb.chartById(sheet.id, copy).appearance).toEqual(original.appearance);
    wb.undo(); expect(sheet.charts).toHaveLength(1);
  }
});
