import { test, expect } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

test('matches native hidden-outline controls and preserves them through editing and undo', async ({ page }, info) => {
  const parts = unzipSync(readFileSync('public/fixtures/hidden-line-controls.docx'));
  const dom = new JSDOM(strFromU8(parts['word/document.xml']), { contentType: 'application/xml' });
  // The last two reference cases have separately unsupported visible raster
  // outlines. Removing trailing cases leaves the six preceding native positions.
  [...dom.window.document.documentElement.firstElementChild.children].slice(12, 16).forEach(n => n.remove());
  parts['word/document.xml'] = strToU8(new dom.window.XMLSerializer().serializeToString(dom.window.document));
  dom.window.close(); const source = zipSync(parts);
  const ref = JSON.parse(readFileSync('tests/fixtures/hidden-line/native.json'));
  const expected = ref.objects.map(o => o.bounds).filter(b => Math.abs(b[2] - b[0] - 144) < .01 && Math.abs(b[3] - b[1] - 24) < .01).sort((a, b) => b[3] - a[3]).slice(0, 6);
  expect(expected).toHaveLength(6);
  await page.goto('/playground.html');
  const actual = await page.evaluate(async data => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { imageExtents } = await import('/src/engine/images.js');
    const p = await DocxPackage.open(new Uint8Array(data)); await loadCanvasFonts(p);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(p.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    return layout.lines.flatMap(l => l.fragments.filter(f => f.image).map(f => {
      const ext = imageExtents(f.image), x = f.x + ext.left / 9525, top = l.baseline - f.ascent + ext.top / 9525;
      return [x * .75, top * .75, f.image.width / 12700, f.image.height / 12700];
    }));
  }, [...source]);
  expect(actual).toHaveLength(6);
  expected.forEach((b, i) => [b[0], 792 - b[3], 144, 24].forEach((v, k) => expect(Math.abs(actual[i][k] - v), `case ${i + 1} coordinate ${k}`).toBeLessThan(.15)));
  await page.getByLabel('Open DOCX file').setInputFiles({ name: 'hidden-line.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(source) });
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/hidden red=True/); await expect(input).toBeEditable();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const original = await input.inputValue();
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath('hidden-line-edited.docx'); await (await pending).saveAs(path);
  const edited = unzipSync(readFileSync(path));
  for (const [name, data] of Object.entries(parts)) if (name !== 'word/document.xml') expect(Buffer.from(edited[name]).equals(Buffer.from(data)), name).toBe(true);
  expect(strFromU8(edited['word/document.xml']).match(/hiddenLine/g)).toHaveLength(6);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  const undone = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const undoPath = info.outputPath('hidden-line-undo.docx'); await (await undone).saveAs(undoPath);
  const restored = unzipSync(readFileSync(undoPath));
  for (const [name, data] of Object.entries(parts)) expect(Buffer.from(restored[name]).equals(Buffer.from(data)), name).toBe(true);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  writeFileSync(info.outputPath('hidden-line.png'), Buffer.from(await page.locator('canvas.canvas-page').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
});
