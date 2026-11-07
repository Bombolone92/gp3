import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('paints bundled scripts at native prefix boundaries without a font permission grant', async ({page}, info) => {
  test.setTimeout(120000);
  const folder = 'tests/fixtures/bundled-script/';
  const reference = JSON.parse(readFileSync(folder + 'origin-reference.json'));
  const source = readFileSync(folder + 'control.docx');
  const hash = data => createHash('sha256').update(data).digest('hex');
  expect(hash(source)).toBe(reference.sourceSha256);
  for (const entry of reference.cases) {
    expect(hash(readFileSync(folder + entry.metafile))).toBe(entry.metafileSha256);
    expect(hash(readFileSync('public/fonts/' + entry.font))).toBe(entry.fontSha256);
  }
  await page.goto('/playground.html');
  const actual = await page.evaluate(async bytes => {
    const {DocxPackage} = await import('/src/engine/docx.js');
    const {loadCanvasFonts} = await import('/src/engine/canvas-text.js');
    const {CanvasEditor} = await import('/src/engine/canvas-editor.js');
    const pkg = await DocxPackage.open(Uint8Array.from(bytes)); await loadCanvasFonts(pkg);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const editor = new CanvasEditor(host, {...pkg, images:new Map()});
    const paints = [], fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text,x,y,...args) {
      if (text === 'TEST') {
        const page = Number(this.canvas.dataset.page), matrix = this.getTransform();
        const scale = this.canvas.width / (editor.layout.pages[page] || editor.layout.page).width;
        const points = Number(/([\d.]+)px/.exec(this.font)[1])*.75;
        paints.push({page, origin:(matrix.e + matrix.a*x + matrix.c*y)/scale*.75,
          sizeX:points*Math.hypot(matrix.a,matrix.b)/scale, sizeY:points*Math.hypot(matrix.c,matrix.d)/scale});
      }
      return fill.call(this,text,x,y,...args);
    };
    try { editor.paint(); } finally { CanvasRenderingContext2D.prototype.fillText = fill; }
    const rows = editor.layout.lines.filter(l => l.fragments.some(f => f.text === 'TEST')).map(line => {
      const prefix = line.fragments.find(f => f.text === 'START '), script = line.fragments.find(f => f.text === 'TEST');
      return {page:line.page, size:script.fontSize, script:script.verticalAlign, prefixEnd:(prefix.x+prefix.width)*.75, origin:script.x*.75};
    });
    return {pages:editor.layout.pageCount, rows, paints};
  }, [...source]);
  expect(actual.pages).toBe(3); expect(actual.rows).toHaveLength(36); expect(actual.paints).toHaveLength(36);
  const comparisons = actual.rows.map((row,i) => {
    const native = reference.cases[row.page].rows[i % 12], paint = actual.paints[i];
    expect(row.size).toBe(native.size); expect(row.script).toBe(native.script); expect(paint.page).toBe(row.page);
    const nativeGap = native.horizontalGapLogical * reference.cases[row.page].horizontalUnitPt;
    expect(Math.abs((paint.origin-row.prefixEnd)-nativeGap)).toBeLessThan(.001);
    // The authored control has 36 pt left margins and no paragraph indents.
    const nativePrefixEnd = 36 + native.prefixEndLogical*reference.cases[row.page].horizontalUnitPt;
    expect(Math.abs(paint.origin-nativePrefixEnd)).toBeLessThan(.2);
    expect(Math.abs(paint.sizeX-native.nativeSizePt)).toBeLessThan(.061);
    expect(Math.abs(paint.sizeY-native.nativeSizePt)).toBeLessThan(.061);
    return {...row, paintedOrigin:paint.origin, nativeGap, nativePrefixEnd, sizeX:paint.sizeX, sizeY:paint.sizeY, nativeSizePt:native.nativeSizePt};
  });
  writeFileSync(info.outputPath('origins.json'),JSON.stringify(comparisons,null,2));
  for (const [i, canvas] of (await page.locator('canvas.canvas-page').all()).entries()) {
    writeFileSync(info.outputPath(`page-${i+1}.png`), Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  }
});
