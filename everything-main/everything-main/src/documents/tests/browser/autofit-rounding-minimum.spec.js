import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

test('AutoFit rounding preserves native single-line content and editable packages', async ({ page }, info) => {
  const folder = 'tests/fixtures/autofit-rounding-minimum/';
  const source = folder + 'control.docx', bytes = readFileSync(source), original = unzipSync(bytes);
  const ref = JSON.parse(readFileSync(folder + 'reference.json'));
  const hash = data => createHash('sha256').update(data).digest('hex');
  expect(hash(bytes)).toBe(ref.sourceSha256);
  expect(hash(readFileSync(folder + 'native.pdf'))).toBe(ref.pdfSha256);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^C000/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const check = async bytes => {
    const actual = await page.evaluate(async bytes => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { layoutDocument } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const { validateCanvasLayout, measureCanvasText } = await import('/src/engine/canvas-text.js');
      const p = await DocxPackage.open(new Uint8Array(bytes)); await validateCanvasLayout(p);
      const ctx = document.createElement('canvas').getContext('2d');
      const l = layoutDocument(p.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(p.pageSettings), p.numbering, p.tables);
      return l.lines.filter(line => line.cellId).map(line => ({
        text: line.fragments.map(f => f.text).join('').trim(), page: line.page,
        x: line.fragments[0]?.x * .75, baseline: line.baseline * .75,
      }));
    }, [...bytes]);
    expect(actual).toHaveLength(ref.lines.length);
    for (const [i, line] of ref.lines.entries()) {
      expect(actual[i].text).toBe(line.text); expect(actual[i].page).toBe(line.page);
      expect(Math.abs(actual[i].x - line.x)).toBeLessThan(.2);
      expect(Math.abs(actual[i].baseline - line.baseline)).toBeLessThan(.2);
    }
  };
  await check(bytes);
  const download = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await download('noedit')))).toEqual(original);
  const text = await input.inputValue();
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Test ');
  const editedText = await input.inputValue(), editedPath = await download('edited'), edited = readFileSync(editedPath), parts = unzipSync(edited);
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(parts[name]).toEqual(original[name]);
  await check(edited);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(text);
  expect(unzipSync(readFileSync(await download('undo')))).toEqual(original);
  page.once('dialog', d => d.accept()); await page.getByLabel('Open DOCX file').setInputFiles(editedPath);
  await expect(input).toHaveValue(editedText); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  expect(errors).toEqual([]);
});
