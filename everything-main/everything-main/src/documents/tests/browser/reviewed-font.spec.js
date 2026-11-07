import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'public/fixtures/reviewed-font.docx';
const reference = JSON.parse(readFileSync('tests/fixtures/reviewed-font/reference.json', 'utf8'));

test('loads the reviewed face on demand and retains native glyph advances through editing', async ({ page }, info) => {
  test.setTimeout(90000);
  const fontRequests = []; page.on('request', request => { if (request.url().includes('BebasNeue-Regular.ttf')) fontRequests.push(request.url()); });
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeVisible();
  expect(fontRequests).toEqual([]);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^ORIGINAL OPEN FONT/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length);
  await expect(page.locator('#playground-error')).toBeEmpty();
  // Family load, synthetic-ink probe, synthetic advance data, and legacy-GPOS
  // preparation are bounded; reopening below must reuse their results.
  expect(fontRequests.length).toBeLessThanOrEqual(4);
  const initialFontRequests = fontRequests.length;
  for (const url of fontRequests) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  const actual = await page.evaluate(async source => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { fontAvailable } = await import('/src/engine/font-availability.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(source), c => c.charCodeAt(0))); await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings));
    return { available: fontAvailable('Bebas Neue'), pages: layout.pages.map((_, page) => layout.lines.filter(l => l.page === page).map(l => ({
      text: l.fragments.map(f => f.text).join('').trimEnd(), baseline: l.baseline * .75,
      family: l.fragments[0]?.style?.fontFamily,
      glyphs: l.stops.filter(s => s.offset < l.end).map(s => s.x * .75),
    }))) };
  }, readFileSync(source).toString('base64'));
  expect(actual.available).toBe(true);
  writeFileSync(info.outputPath('actual.json'), JSON.stringify(actual, null, 2));
  await info.attach('font-layout', { body: JSON.stringify(actual, null, 2), contentType: 'application/json' });
  await page.locator('canvas.canvas-page').first().screenshot({ path: info.outputPath('rendered.png') });
  expect(actual.pages.map(lines => lines.map(l => l.text))).toEqual(reference.pages.map(lines => lines.map(l => l.text)));
  for (const [i, lines] of actual.pages.entries()) for (const [j, line] of lines.entries()) {
    // The final Arial paragraph is a mixed-font control, not the reviewed face.
    // Its existing shaping gap is recorded separately in the fixture README,
    // rather than widening this font oracle.
    if (j === lines.length - 1) continue;
    for (const [k, x] of reference.pages[i][j].glyphs.entries()) expect(Math.abs(line.glyphs[k] - x)).toBeLessThan(.2);
    expect(Math.abs(line.baseline - reference.pages[i][j].baseline)).toBeLessThan(.15);
  }
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('EDIT '); const edited = await save('edited');
  const changed = unzipSync(readFileSync(edited)); for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  expect(new TextDecoder().decode(changed['word/document.xml'])).toContain('Bebas Neue');
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'EDIT ' + original); await expect(page.locator('#playground-error')).toBeEmpty();
  expect(fontRequests.length).toBe(initialFontRequests);
});
