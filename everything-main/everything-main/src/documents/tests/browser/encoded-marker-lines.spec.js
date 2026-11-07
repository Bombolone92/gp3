import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { reopenDocx } from './helpers/reopen-docx.js';

const folder = 'tests/fixtures/encoded-marker-lines';
const word = JSON.parse(readFileSync(`${folder}/positions.json`, 'utf8'));
const bytes = readFileSync(`${folder}/encoded-marker-lines.docx`);
test('matches native encoded marker automatic spacing and preserves layout through editing, undo and export', async ({ page }, info) => {
  await page.goto('/playground.html');
  const referenceFontsInstalled = await page.evaluate(async () => {
    try {
      await Promise.all(['Arial', 'Symbol', 'Franklin Gothic Book'].map(name => new FontFace('Reference check', `local("${name}")`).load()));
      return true;
    } catch { return false; }
  });
  test.skip(!referenceFontsInstalled, 'The native reference requires the original installed reference fonts.');
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/encoded-marker-lines.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^C00 first/);
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { TextDocument } = await import('/src/engine/model.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables);
    const layout = () => layoutDocument(doc.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
    const before = layout(); doc.select(0); doc.replace('Edited '); doc.undo();
    return { unchanged: JSON.stringify(layout()) === JSON.stringify(before), pages: before.pageCount,
      lines: before.lines.map(l => ({ text: l.fragments.map(f => f.text || '').join('').trim(), y: l.baseline * .75 })) };
  }, bytes.toString('base64'));
  expect(result.unchanged).toBe(true); expect(result.pages).toBe(24);
  expect(result.lines).toHaveLength(word.length);
  for (const [i, line] of result.lines.entries()) {
    expect(line.text).toBe(word[i].text);
    expect(Math.abs(line.y - word[i].y), line.text).toBeLessThan(.25);
  }
  await expect(page.locator('canvas.canvas-page')).toHaveCount(24);
  for (let i = 0; i < 24; i++) writeFileSync(info.outputPath(`page${i+1}.png`), Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  const original = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath('encoded-marker-lines.docx'); await (await pending).saveAs(path);
  await reopenDocx(page, input, path, 'Edited ' + original);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
