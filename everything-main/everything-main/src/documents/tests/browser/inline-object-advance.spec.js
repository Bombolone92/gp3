import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const ref = JSON.parse(readFileSync('tests/fixtures/inline-object-advance/reference.json'));
test('matches native following-paragraph advances and picture positions under automatic spacing', async ({ page }) => {
  expect(createHash('sha256').update(readFileSync('public/fixtures/inline-object-advance.docx')).digest('hex')).toBe(ref.sourceSha256);
  await page.goto('/playground.html');
  const actual = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const p = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/inline-object-advance.docx')).arrayBuffer()));
    await loadCanvasFonts(p); const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(p.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    return { pageCount: layout.pageCount, cases: Array.from({ length: p.paragraphs.length / 3 }, (_, i) => {
      const [before, object, after] = p.paragraphs.slice(3*i, 3*i+3).map(p => layout.lines.find(l => l.paragraphId === p.id));
      const image = object.fragments.find(f => f.image), top = object.baseline-image.ascent;
      return { advance: (after.baseline-before.baseline)*.75, top: top*.75, bottom: (top+image.image.height/9525)*.75 };
    }) };
  });
  expect(actual.pageCount).toBe(ref.cases.length);
  for (const [i, row] of ref.cases.entries()) {
    expect(Math.abs(actual.cases[i].advance-row.advance), `${row.id} following paragraph`).toBeLessThan(.15);
    for (const edge of ['top', 'bottom']) expect(Math.abs(actual.cases[i][edge]-row.object[edge]), `${row.id} ${edge}`).toBeLessThan(.15);
  }
});
