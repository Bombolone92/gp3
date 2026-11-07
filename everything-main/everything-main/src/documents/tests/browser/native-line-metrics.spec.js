import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { reopenDocx } from './helpers/reopen-docx.js';

const word = JSON.parse(readFileSync('tests/fixtures/native-line-metrics/positions.json', 'utf8'));
test('matches native reference baselines for native fonts and preserves layout through editing, undo and export', async ({ page }, info) => {
  await page.goto('/playground.html');
  const referenceFontsInstalled = await page.evaluate(async () => {
    try {
      await Promise.all(['Arial', 'Times New Roman', 'Calibri', 'Courier New'].map(name => new FontFace('Reference check', `local("${name}")`).load()));
      return true;
    } catch { return false; }
  });
  test.skip(!referenceFontsInstalled, 'The native reference requires the four original installed reference fonts.');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/native-line-metrics.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Arial 11 line 1/);
  const result = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { TextDocument } = await import('/src/engine/model.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/native-line-metrics.docx')).arrayBuffer()));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables);
    const layout = () => layoutDocument(doc.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
    const before = layout(); doc.select(0); doc.replace('Edited '); doc.undo();
    return { unchanged: JSON.stringify(layout()) === JSON.stringify(before), pages: before.pageCount,
      lines: before.lines.map(l => ({ text: l.fragments.map(f => f.text || '').join('').trim(), y: l.baseline * .75 })) };
  });
  expect(result.unchanged).toBe(true); expect(result.pages).toBe(4);
  expect(result.lines).toHaveLength(word.length);
  for (const [i, line] of result.lines.entries()) {
    expect(line.text).toBe(word[i].text);
    expect(Math.abs(line.y - word[i].y), line.text).toBeLessThan(.25);
  }
  const original = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath('native-line-metrics.docx'); await (await pending).saveAs(path);
  await reopenDocx(page, input, path, 'Edited ' + original);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
