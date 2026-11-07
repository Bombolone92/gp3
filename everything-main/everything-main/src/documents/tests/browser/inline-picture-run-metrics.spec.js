import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

for (const name of ['source', 'modern', 'spacing']) test(`native mixed picture/text line metrics: ${name}`, async ({ page }, info) => {
  const root = 'tests/fixtures/inline-picture-run-metrics/';
  const ref = JSON.parse(readFileSync(root + name + '-reference.json'));
  await page.goto('/playground.html');
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(pkg);
    const context = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (t,s) => measureCanvasText(context,t,s), pageGeometry(pkg.pageSettings));
    return layout.pages.map((_, i) => Object.fromEntries(layout.lines.filter(l => l.page === i).map(l => [l.fragments.filter(f => !f.image).map(f => f.text).join('').trim(), l.baseline * .75])));
  }, [...readFileSync(root + name + '.docx')]);
  writeFileSync(info.outputPath(name + '-baselines.json'), JSON.stringify(actual));
  expect(actual).toHaveLength(ref.pages.length);
  for (const [i, expected] of ref.pages.entries()) for (const text of ['Before','Tail','After'])
    expect(Math.abs(actual[i][text] - expected[text]), `${name} page ${i+1} ${text}`).toBeLessThan(.15);
});
