import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { showAllTools } from './helpers/editor-tools.js';
const ref = JSON.parse(readFileSync('tests/fixtures/combined-caps/reference.json'));
test('paints combined capitalization like the native reference through edit, reopen and undo', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.capsPaint = {}; const current = new WeakMap(), paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
      if (this.canvas.classList.contains('canvas-page')) {
        if (/^K\d{2}\s*$/.test(text)) { const id = text.trim(); current.set(this.canvas, id); window.capsPaint[id] = []; }
        else if (current.has(this.canvas)) {
          const size = Number(/([\d.]+)px/.exec(this.font)[1]) * .75;
          window.capsPaint[current.get(this.canvas)].push(...[...text].filter(c => !/\s/.test(c)).map(c => [c, size]));
        }
      }
      return paint.call(this, text, x, y, ...args);
    };
  });
  const source = 'public/fixtures/combined-caps.docx';
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^K00 Abc XYZ/); await expect(input).toBeEditable();
  const original = await input.inputValue();
  const check = async () => {
    await expect(page.locator('#playground-error')).toBeEmpty();
    await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
    const painted = await page.evaluate(() => window.capsPaint);
    for (const row of ref.cases) {
      expect(painted[row.id].map(g => g[0]), row.id).toEqual(row.glyphs.map(g => g[0]));
      row.glyphs.forEach(([, size], i) => expect(Math.abs(painted[row.id][i][1] - size), row.id).toBeLessThan(.1));
    }
  };
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath('combined-caps-' + name + '.docx'); await (await pending).saveAs(path); return path;
  };
  await check();
  // Edit a blank separator, leaving the independently measured labels intact.
  await input.evaluate(el => { el.focus(); const at = el.value.indexOf('\n\n'); el.setSelectionRange(at + 1, at + 1); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.keyboard.insertText(' '); const editedText = await input.inputValue(); await check();
  const edited = await save('edited'), before = unzipSync(readFileSync(source)), parts = unzipSync(readFileSync(edited));
  for (const [n, b] of Object.entries(before)) if (n !== 'word/document.xml') expect(parts[n]).toEqual(b);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); await check();
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(before);
  await reopenDocx(page, input, edited, editedText); await check();
  await showAllTools(page);
  await input.evaluate(el => { const at = el.value.indexOf('K13 ') + 4; el.setSelectionRange(at, at + 3); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Style capitalization', exact: true })).toHaveValue('capsSmallCapsOff');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await check();
});
