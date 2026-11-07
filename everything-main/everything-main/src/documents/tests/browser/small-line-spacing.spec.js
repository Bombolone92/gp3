import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference = JSON.parse(readFileSync('tests/fixtures/small-line-spacing/reference.json', 'utf8'));
test('matches native small-point advances and allows small values through the spacing dialog', async ({ page }, info) => {
  expect(createHash('sha256').update(readFileSync('public/fixtures/small-line-spacing.docx')).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html'); await showAllTools(page);
  const actual = await page.evaluate(async () => {
    try { await new FontFace('Reference Arial', 'local("Arial")').load(); } catch { return null; }
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const p = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/small-line-spacing.docx')).arrayBuffer()));
    await loadCanvasFonts(p); const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(p.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    return p.paragraphs.filter(p => p.runs.map(r => r.text).join('') === 'Ag\vBg').map(p => {
      const lines = layout.lines.filter(l => l.paragraphId === p.id);
      return { advance: (lines[1].baseline - lines[0].baseline) * .75, clip: lines[0].clip };
    });
  });
  if (actual) {
    expect(actual).toHaveLength(reference.cases.length);
    reference.cases.forEach((c, i) => {
      expect(Math.abs(actual[i].advance - c.advance), c.label).toBeLessThan(.15);
      expect(actual[i].clip, c.label).toBe(c.rule === 'exact' && c.points > 0);
    });
  } else test.info().annotations.push({ type: 'reference-font', description: 'Arial absent; native reference metric check omitted. Import/edit checks still run.' });
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/small-line-spacing.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Small line spacing/); await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue();
  await input.evaluate(el => { const at = el.value.indexOf('Ag'); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); });
  for (const [rule, amount] of [['atLeast', '1'], ['exact', '.05'], ['exact', '0']]) {
    await page.getByRole('button', { name: 'Line spacing options', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Line spacing', exact: true });
    await dialog.getByRole('combobox', { name: 'Line spacing rule' }).selectOption(rule);
    const field = dialog.getByRole('spinbutton', { name: 'Line spacing amount' });
    await expect(field).toHaveAttribute('min', '0'); await field.fill(amount);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect(input).toBeFocused(); await expect(page.locator('#playground-error')).toBeEmpty();
  }
  const save = async suffix => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`small-line-spacing-${suffix}.docx`); await (await pending).saveAs(path); return path;
  };
  const edited = await save('edited');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync('public/fixtures/small-line-spacing.docx')));
  await reopenDocx(page, input, edited, original); await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
