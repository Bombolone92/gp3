// Compare native reference text-effect line metrics. Exits nonzero on any mismatch.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const folder = 'tests/fixtures/text-shadow-line-metrics/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
const actualDocuments = {};
const mismatches = [];
try {
  const page = await browser.newPage();
  await page.goto(process.env.DOCX_TEST_URL || 'http://127.0.0.1:5173/playground.html');
  for (const [name, ref] of Object.entries(reference.documents)) {
    const actual = await page.evaluate(async bytes => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
      const { fontAvailable, prepareCanvasFont } = await import('/src/engine/font-availability.js');
      const { layoutDocument } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const pkg = await DocxPackage.open(new Uint8Array(bytes));
      await loadCanvasFonts(pkg);
      for (const family of ['Corbel', 'Rockwell', 'Arial']) {
        await prepareCanvasFont(family);
        if (!fontAvailable(family)) throw new Error(`Missing reference font: ${family}`);
      }
      const ctx = document.createElement('canvas').getContext('2d');
      const layout = layoutDocument(pkg.paragraphs, (text, style) => measureCanvasText(ctx, text, style), pageGeometry(pkg.pageSettings));
      return layout.pages.map((_, index) => layout.lines.filter(line => line.page === index).map(line => ({
        text: line.fragments.map(fragment => fragment.text).join('').trim(), x: line.stops[0].x * .75, y: line.baseline * .75,
      })).filter(line => line.text));
    }, [...readFileSync(folder + name + '.docx')]);
    actualDocuments[name] = actual;
    if (actual.length !== ref.pages.length) mismatches.push({document: name, pageCount: actual.length, expected: ref.pages.length});
    for (const [index, pageRef] of ref.pages.entries()) {
      const occurrences = new Map();
      for (const expected of pageRef.lines) {
        const occurrence = occurrences.get(expected.text) || 0;
        occurrences.set(expected.text, occurrence + 1);
        const line = (actual[index] || []).filter(line => line.text === expected.text)[occurrence];
        if (!line || Math.abs(line.x - expected.x) > .15 || Math.abs(line.y - expected.y) > .15) {
          mismatches.push({document: name, page: index + 1, expected, actual: line});
        }
      }
      if (!['outline', 'both'].includes(pageRef.effect) && actual[index]?.length !== pageRef.lines.length) {
        mismatches.push({document: name, page: index + 1, lineCount: actual[index]?.length, expected: pageRef.lines.length});
      }
    }
  }
} finally { await browser.close(); }
const pages = Object.values(actualDocuments).reduce((total, pages) => total + pages.length, 0);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({pages, mismatches, actualDocuments}, null, 2) + '\n');
console.log(JSON.stringify({pages, mismatches: mismatches.length, failures: mismatches.map(item => ({document: item.document, page: item.page}))}));
process.exitCode = mismatches.length ? 1 : 0;
