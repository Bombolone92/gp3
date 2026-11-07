// Compare cross-paragraph wrapping against independently captured native reference baselines.
// Run against a fresh Vite instance; Arial must be available on the test machine.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const family = process.argv[3] || 'flow';
if (!['flow', 'spacing', 'table'].includes(family)) throw new Error('Expected fixture family: flow, spacing or table.');
const root = new URL(`../tests/fixtures/top-bottom-${family}/`, import.meta.url);
const source = readFileSync(new URL(family === 'flow' ? 'control.docx' : `top-bottom-${family}.docx`, root));
const reference = JSON.parse(readFileSync(new URL('native.json', root), 'utf8'));
if (createHash('sha256').update(source).digest('hex') !== reference.sourceSha256) throw new Error('Source differs from the native reference.');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ permissions: ['local-fonts'] });
  await page.goto(process.argv[2] || 'http://127.0.0.1:5173/playground.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText, setCanvasFontAlternatives } = await import('/src/engine/canvas-text.js');
    const { fontAvailable, checkFontAvailability } = await import('/src/engine/font-availability.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await validateCanvasLayout(pkg);
    await checkFontAvailability('Arial');
    if (!fontAvailable('Arial')) throw new Error('Native comparison requires available Arial.');
    const context = document.createElement('canvas').getContext('2d');
    setCanvasFontAlternatives(context, pkg.styles.fontAlternatives);
    const layout = layoutDocument(pkg.paragraphs, (text, style) => measureCanvasText(context, text, style),
      pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { styles: pkg.styles, drawingLayouts: pkg.drawingLayouts });
    return { pageCount: layout.pageCount, lines: layout.lines.map(l => ({ page: l.page,
      text: l.fragments.filter(f => !f.image).map(f => f.text).join('').trim(), baselinePt: l.baseline * .75 })) };
  }, source.toString('base64'));
  const rows = reference.lines.map(expected => {
    const matches = actual.lines.filter(line => line.page === expected.page && line.text === expected.text);
    return { ...expected, actualBaselinePt: matches.length === 1 ? matches[0].baselinePt : null,
      deltaPt: matches.length === 1 ? matches[0].baselinePt - expected.baselinePt : null };
  });
  const failures = rows.filter(row => row.deltaPt === null || Math.abs(row.deltaPt) > reference.tolerancePt);
  console.log(JSON.stringify({ sourceSha256: reference.sourceSha256, expectedPages: reference.pages,
    actualPages: actual.pageCount, tolerancePt: reference.tolerancePt, checked: rows.length, failures, rows }, null, 2));
  if (failures.length || actual.pageCount !== reference.pages) process.exitCode = 1;
} finally {
  await browser.close();
}
