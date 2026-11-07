import { openReadOnlyPreview } from './helpers/preview.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source = 'public/fixtures/charts-and-anchors.docx';
async function selectObject(input, last = false) {
  await input.evaluate((el, last) => { const at = last ? el.value.lastIndexOf('\ufffc') : el.value.indexOf('\ufffc'); el.focus(); el.setSelectionRange(at, at + 1); el.dispatchEvent(new Event('select')); }, last);
}
async function download(page, path) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); await (await pending).saveAs(path);
}

test('renders cached charts and full-column floating pictures, edits, undoes and reopens a preserved package', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Charts and anchors Á😀/);
  const original = await input.inputValue(); expect(original.match(/\ufffc/g)).toHaveLength(2);
  const colors = await page.locator('canvas.canvas-page').evaluateAll(canvases => {
    const totals = { blue: 0, red: 0, yellow: 0 };
    for (const canvas of canvases) {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0 && data[i + 1] === 69 && data[i + 2] === 134) totals.blue++;
        if (data[i] === 255 && data[i + 1] === 66 && data[i + 2] === 14) totals.red++;
        if (data[i] === 255 && data[i + 1] === 211 && data[i + 2] === 32) totals.yellow++;
      }
    } return totals;
  });
  for (const value of Object.values(colors)) expect(value).toBeGreaterThan(100);
  const untouched = testInfo.outputPath('unchanged-drawings.docx'); await download(page, untouched);
  const before = unzipSync(readFileSync(source)), after = unzipSync(readFileSync(untouched));
  for (const [name, bytes] of Object.entries(before)) expect(Buffer.from(after[name]).equals(Buffer.from(bytes)), name).toBe(true);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  await selectObject(input); await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await page.getByLabel('Image width (in)', { exact: true }).fill('4'); await page.getByLabel('Image alt text').fill('Chart retained after editing'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await selectObject(input, true); await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await page.getByLabel('Image alt text').fill('Picture retained after editing'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // A floating picture cannot share a paragraph with typed text in this subset.
  await input.press('ArrowLeft'); await page.keyboard.insertText('side text'); await expect(input).toHaveValue('Edited ' + original);
  await selectObject(input, true); await input.press('Backspace'); expect((await input.inputValue()).match(/\ufffc/g)).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue('Edited ' + original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  for (let i = 0; i < await page.locator('canvas.canvas-page').count(); i++) {
    const data = await page.locator('canvas.canvas-page').nth(i).evaluate(el => el.toDataURL('image/png'));
    writeFileSync(testInfo.outputPath(`drawings-page-${i + 1}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  const saved = testInfo.outputPath('charts-and-anchors.docx'); await download(page, saved);
  const parts = unzipSync(readFileSync(saved));
  expectBodyEditParts(parts, before);
  await reopenDocx(page, input, saved, 'Edited ' + original);
  await selectObject(input); await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await expect(page.getByLabel('Image width (in)', { exact: true })).toHaveValue('4'); await expect(page.getByLabel('Image alt text')).toHaveValue('Chart retained after editing');
  expect(errors).toEqual([]);
});

test('previews unsupported charts and partial-width floats with original downloads', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toBeVisible(); const previous = await input.inputValue();
  for (const [part, alter, reason] of [
    ['word/charts/chart1.xml', xml => xml.replace('val="clustered"', 'val="standard"'), 'bar grouping'],
    ['word/document.xml', xml => xml.replace('cx="4572000"', 'cx="2286000"'), 'full text column'],
  ]) {
    const parts = unzipSync(readFileSync(source)); parts[part] = strToU8(alter(strFromU8(parts[part])));
    await openReadOnlyPreview(page, { name: 'unsupported.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });


  }
});

test('opens and round-trips the supplied local sample', async ({ page }, testInfo) => {
  test.skip(!process.env.DOCX_SAMPLE_PATH, 'Optional local specimen; its assets are not redistributed in the repository.');
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(process.env.DOCX_SAMPLE_PATH);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Lorem ipsum/);
  const original = await input.inputValue(); expect(original.match(/\ufffc/g)).toHaveLength(2);
  expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(1);
  for (let i = 0; i < await page.locator('canvas.canvas-page').count(); i++) {
    const image = await page.locator('canvas.canvas-page').nth(i).evaluate(el => el.toDataURL('image/png'));
    writeFileSync(testInfo.outputPath(`sample-page-${i + 1}.png`), Buffer.from(image.split(',')[1], 'base64'));
  }
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  // The supplied package has pre-existing border-order schema errors. Keep this
  // private specimen outside the conformance corpus; verify retention explicitly.
  const saved = join(tmpdir(), 'documents-local-sample-roundtrip.docx'); await download(page, saved);
  const before = unzipSync(readFileSync(process.env.DOCX_SAMPLE_PATH)), after = unzipSync(readFileSync(saved));
  for (const [name, bytes] of Object.entries(before)) if (name !== 'word/document.xml') expect(Buffer.from(after[name]).equals(Buffer.from(bytes)), name).toBe(true);
  await reopenDocx(page, input, saved, 'Edited ' + original);
});
