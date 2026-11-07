import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const folder = 'tests/fixtures/script-kerning-defaults/';
const cases = JSON.parse(readFileSync(folder + 'cases.json'));
test.use({permissions: ['local-fonts']});
for (const entry of cases) test(`matches native prefix kerning: ${entry.name}`, async ({page}, info) => {
  test.setTimeout(120000);
  const native = JSON.parse(readFileSync(folder + 'reference.json')).find(c => c.name === entry.name);
  const bytes = readFileSync(folder + entry.name + '.docx');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
  expect(createHash('sha256').update(readFileSync(folder + entry.name + '-native.pdf')).digest('hex')).toBe(native.pdfSha256);
  await page.goto('/playground.html');
  const rows = await page.evaluate(async bytes => {
    const {DocxPackage} = await import('/src/engine/docx.js');
    const {loadCanvasFonts, measureCanvasText} = await import('/src/engine/canvas-text.js');
    const {layoutDocument} = await import('/src/engine/layout.js');
    const {pageGeometry} = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(bytes));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, {styles:pkg.styles});
    return layout.lines.map(line => {
      const prefix = line.fragments.find(f => f.text === 'START ');
      const script = line.fragments.find(f => f.text === 'TEST');
      return {prefixX:prefix.x*.75, scriptAdvanceOrigin:script.x*.75, family:prefix.fontFamily,
        ligatures:prefix.ligatures, kerning:prefix.kerning, legacyKerning:prefix.legacyKerning};
    });
  }, [...bytes]);
  expect(rows).toHaveLength(27);
  writeFileSync(info.outputPath('prefixes.json'), JSON.stringify(rows, null, 2));
  for (const [i, row] of rows.entries()) {
    const expected = native.rows[i];
    expect(row.family).toBe(expected.family);
    expect(row.kerning).toBe(expected.nativeKerning);
    // Isolate prefix shaping. Italic script paint offsets remain a separate
    // native-origin discrepancy covered by script-horizontal-origin.spec.js.
    expect.soft(Math.abs(row.scriptAdvanceOrigin - expected.scriptX), `${entry.name} row ${i}: ${JSON.stringify(row)}`).toBeLessThan(.2);
  }
});
