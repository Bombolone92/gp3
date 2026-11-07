import { openReadOnlyPreview } from './helpers/preview.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

async function download(page, path) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); await (await pending).saveAs(path);
}
for (const fixture of ['grouped-drawings.docx', 'group-locks.docx', null]) test(`opens, edits, and preserves ${fixture || 'the local book report'}`, async ({ page }, info) => {
  const local = fixture === null;
  test.skip(local && !process.env.BOOK_REPORT_PATH, 'Local specimen is not redistributed.');
  const source = local ? process.env.BOOK_REPORT_PATH : `public/fixtures/${fixture}`;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(local ? /My Book Report Title/ : /Grouped drawings/);
  await expect(page.locator('#playground-error')).toBeEmpty();
  const original = await input.inputValue();
  const colors = await page.locator('canvas.canvas-page').evaluateAll(canvases => canvases.reduce((total, canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 194 && data[i + 1] === 203 && data[i + 2] === 147) total++;
    return total;
  }, 0));
  expect(colors).toBeGreaterThan(100);
  await input.evaluate(el => { const at = el.value.indexOf('\ufffc'); el.focus(); el.setSelectionRange(at, at + 1); el.dispatchEvent(new Event('select')); });
  await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('preserved as a complete object');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await input.press('Backspace'); expect((await input.inputValue()).match(/\ufffc/g)).toHaveLength(original.match(/\ufffc/g).length - 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  expect(original.match(/\ufffc/g).length).toBeGreaterThan(2);
  expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(1);
  await input.press('ControlOrMeta+Home');
  for (let i = 0; i < await page.locator('canvas.canvas-page').count(); i++) {
    const image = await page.locator('canvas.canvas-page').nth(i).evaluate(el => el.toDataURL('image/png'));
    writeFileSync(info.outputPath(`report-page-${i + 1}.png`), Buffer.from(image.split(',')[1], 'base64'));
  }
  await input.press('ControlOrMeta+Home');
  await input.evaluate(el => {
    const data = new DataTransfer(); data.setData('text/plain', 'Edited ');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(input).toHaveValue('Edited ' + original);
  const saved = local ? join(tmpdir(), 'documents-book-report-roundtrip.docx') : info.outputPath(fixture);
  await download(page, saved);
  const before = unzipSync(readFileSync(source)), after = unzipSync(readFileSync(saved));
  expectBodyEditParts(after, before);
  await reopenDocx(page, input, saved, 'Edited ' + original);
  if (!local) {
    await input.evaluate(el => { const at = el.value.indexOf('Second section starts lower.') - 1; el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select')); });
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await input.press('Enter'); await page.keyboard.insertText('Inserted at section end');
    const sectionExport = info.outputPath(fixture.replace('.docx', '-section-edit.docx')); await download(page, sectionExport);
    await reopenDocx(page, input, sectionExport, await input.inputValue());
  }
  expect(errors).toEqual([]);
});


test('previews unsupported selected drawing content as read-only with the original available', async ({ page }, info) => {
  await page.goto('/playground.html'); await showAllTools(page);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toBeVisible();
  const original = await input.inputValue(), parts = unzipSync(readFileSync('public/fixtures/grouped-drawings.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<wpg:grpSpPr>', '<wpg:grpSpPr><a:effectLst/>'));
  await openReadOnlyPreview(page, { name: 'unsupported.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

});

test('previews invalid and selection-locked groups as read-only with the original available', async ({ page }, info) => {
  await page.goto('/playground.html');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toBeVisible();
  const original = await input.inputValue(), source = readFileSync('public/fixtures/group-locks.docx');
  for (const [attribute, message] of [['noSelect="1"', 'selection-locked groups'], ['noChangeAspect="yes"', 'invalid group lock flags']]) {
    const parts = unzipSync(source);
    parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('noChangeAspect="1"', attribute));
    await openReadOnlyPreview(page, { name: 'unsupported.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

  }
});
