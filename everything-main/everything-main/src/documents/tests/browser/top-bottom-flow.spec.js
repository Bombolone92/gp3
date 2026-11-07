import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

test.use({ permissions: ['local-fonts'] });
for (const family of ['flow', 'spacing', 'table']) test(`top-and-bottom ${family}: native geometry and editable preservation`, async ({ page }, info) => {
  test.setTimeout(180000);
  const root = `tests/fixtures/top-bottom-${family}/`;
  const path = root + (family === 'flow' ? 'control.docx' : `top-bottom-${family}.docx`);
  const source = readFileSync(path), reference = JSON.parse(readFileSync(root + 'native.json', 'utf8'));
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(path);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^CASE 0/); await expect(input).toBeEditable();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages);
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText, setCanvasFontAlternatives } = await import('/src/engine/canvas-text.js');
    const { fontAvailable, checkFontAvailability } = await import('/src/engine/font-availability.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await validateCanvasLayout(pkg); await checkFontAvailability('Arial');
    if (!fontAvailable('Arial')) throw new Error('Native reference requires available Arial.');
    const context = document.createElement('canvas').getContext('2d');
    setCanvasFontAlternatives(context, pkg.styles.fontAlternatives);
    const result = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(context, t, s), pageGeometry(pkg.pageSettings),
      pkg.numbering, pkg.tables, pkg.pageStories, { styles: pkg.styles, drawingLayouts: pkg.drawingLayouts });
    return result.lines.map(l => ({ page: l.page, text: l.fragments.filter(f => !f.image).map(f => f.text).join('').trim(), baselinePt: l.baseline * .75 }));
  }, source.toString('base64'));
  for (const row of reference.lines) {
    const matches = actual.filter(l => l.page === row.page && l.text === row.text);
    expect(matches, row.text).toHaveLength(1);
    expect(Math.abs(matches[0].baselinePt - row.baselinePt), row.text).toBeLessThanOrEqual(reference.tolerancePt);
  }
  if (family === 'flow') await expect.poll(() => page.locator('canvas.canvas-page').nth(3).evaluate(c => {
    const scale = c.width / 612;
    return [...c.getContext('2d').getImageData(Math.round(90 * scale), Math.round(150 * scale), 1, 1).data].slice(0, 3);
  })).toEqual([20, 80, 190]);
  const save = async name => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const output = info.outputPath(`${name}.docx`); await (await event).saveAs(output); return output;
  };
  const original = await input.inputValue(), parts = unzipSync(source);
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('EDIT ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const [name, value] of Object.entries(parts)) if (name !== 'word/document.xml') expect(changed[name]).toEqual(value);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'EDIT ' + original);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
