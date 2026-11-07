import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/autofit-writing-minimum';

for (const mode of [12, 15]) test(`matches native empty-cell minima and edits the cell in mode ${mode}`, async ({page}, info) => {
  const source = readFileSync(`${folder}/mode${mode}.docx`);
  const reference = JSON.parse(readFileSync(`${folder}/mode${mode}-cell-widths.json`));
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sha256);
  await page.goto('/playground.html');
  const fonts = await page.evaluate(async () => {
    try { for (const font of ['Arial', 'Calibri']) await new FontFace('Native check', `local("${font}")`).load(); return true; }
    catch { return false; }
  });
  test.skip(!fonts, 'Native reference requires Arial and Calibri.');
  const widths = async bytes => page.evaluate(async bytes => {
    const {DocxPackage} = await import('/src/engine/docx.js');
    const {layoutDocument} = await import('/src/engine/layout.js');
    const {pageGeometry} = await import('/src/engine/page-settings.js');
    const {loadCanvasFonts, measureCanvasText} = await import('/src/engine/canvas-text.js');
    const p = await DocxPackage.open(Uint8Array.from(bytes)); await loadCanvasFonts(p);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(p.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    return p.tables.map(t => layout.cells.find(c => c.id === t.rows[0].cells[0].id).width * .75);
  }, [...bytes]);
  const actual = await widths(source);
  expect(actual).toHaveLength(24);
  for (const [i, width] of actual.entries()) expect(Math.abs(width - reference.tables[i][0].width), `cell ${i + 1}`).toBeLessThan(.01);
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/mode${mode}.docx`);
  const input = page.getByRole('textbox', {name:'Document text'});
  await expect(input).toHaveValue(/^Case 1:/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
  for (let i = 0; i < 6; i++) writeFileSync(info.outputPath(`page${i+1}.png`), Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  const download = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', {name:'Download .docx', exact:true}).click();
    const path = info.outputPath(name); await (await pending).saveAs(path); return path;
  };
  const original = await input.inputValue();
  await input.focus();
  await input.evaluate(el => { const at = el.value.indexOf('\n') + 1; el.setSelectionRange(at, at); });
  await page.keyboard.insertText('M');
  const editedText = await input.inputValue(); expect(editedText).not.toBe(original);
  const edited = await download('edited.docx');
  const changedWidths = await widths(readFileSync(edited));
  expect(changedWidths[0]).toBeGreaterThan(actual[0]);
  expect(changedWidths.slice(1)).toEqual(actual.slice(1));
  const before = unzipSync(source), after = unzipSync(readFileSync(edited));
  for (const name of Object.keys(before)) if (name !== 'word/document.xml') expect(Buffer.from(after[name]).equals(Buffer.from(before[name])), name).toBe(true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  const undone = unzipSync(readFileSync(await download('undo.docx')));
  for (const name of Object.keys(before)) expect(Buffer.from(undone[name]).equals(Buffer.from(before[name])), name).toBe(true);
  await reopenDocx(page, input, edited, editedText);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
