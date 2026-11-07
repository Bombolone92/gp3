import { openReadOnlyPreview } from './helpers/preview.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { showAllTools, onTab } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

async function download(page, path) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); await (await pending).saveAs(path);
}
for (const local of [false, true]) test(`opens, edits, and preserves ${local ? 'the local annual report' : 'annual report features'}`, async ({ page }, info) => {
  test.skip(local && !process.env.ANNUAL_REPORT_PATH, 'Local specimen is not redistributed.');
  const source = local ? process.env.ANNUAL_REPORT_PATH : 'public/fixtures/annual-report.docx';
  const native = local ? null : JSON.parse(readFileSync('tests/fixtures/annual-report-origin/reference.json'));
  const verifyOrigins = async path => {
    if (!native) return;
    const positions = await page.evaluate(async bytes => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { paragraphText } = await import('/src/engine/model.js');
      const { layoutDocument } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
      const p = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0))); await loadCanvasFonts(p);
      const ctx = document.createElement('canvas').getContext('2d');
      const layout = layoutDocument(p.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(p.pageSettings), p.numbering, p.tables);
      return Object.fromEntries(p.paragraphs.filter(p => p.cellId).map(p => {
        const line = layout.lines.find(l => l.paragraphId === p.id);
        return [paragraphText(p).replace(/\ufffc/g, '').trim(), { page: line.page, x: line.stops[0].x * .75 }];
      }));
    }, readFileSync(path).toString('base64'));
    for (const [label, expected] of Object.entries(native.positions)) {
      expect(positions[label].page).toBe(expected.page);
      expect(Math.abs(positions[label].x - expected.x), label).toBeLessThanOrEqual(.1);
    }
  };
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(page.locator('#playground-error')).toBeEmpty();
  await expect(input).toHaveValue(local ? /DAILY WEAR/ : /Annual report features/);
  const original = await input.inputValue(), count = original.match(/\ufffc/g).length;
  expect(count).toBe(local ? 12 : 3);
  await verifyOrigins(source);
  const saved = name => local ? join(tmpdir(), `documents-annual-${name}.docx`) : info.outputPath(name + '.docx');
  const unchanged = saved('annual-unchanged'); await download(page, unchanged);
  const before = unzipSync(readFileSync(source)), same = unzipSync(readFileSync(unchanged));
  for (const [name, bytes] of Object.entries(before)) expect(Buffer.from(same[name]).equals(Buffer.from(bytes)), name).toBe(true);
  // Atomic object deletion and undo retain the exact package.
  await input.evaluate(el => { const at = el.value.indexOf('\ufffc'); el.focus(); el.setSelectionRange(at, at + 1); el.dispatchEvent(new Event('select')); });
  await input.press('Backspace'); expect((await input.inputValue()).match(/\ufffc/g)).toHaveLength(count - 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  for (let i = 0; i < await page.locator('canvas.canvas-page').count(); i++) {
    const image = await page.locator('canvas.canvas-page').nth(i).evaluate(el => el.toDataURL('image/png'));
    writeFileSync(info.outputPath(`annual-page-${i + 1}.png`), Buffer.from(image.split(',')[1], 'base64'));
  }
  if (!local) {
    const colors = await page.locator('canvas.canvas-page').evaluateAll(cs => cs.reduce((sum, c) => {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 4) if (data[i] === 40 && data[i + 1] === 130 && data[i + 2] === 180) sum++;
      return sum;
    }, 0));
    expect(colors).toBeGreaterThan(1000);
  }
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const path = saved('annual-report'); await download(page, path);
  const after = unzipSync(readFileSync(path));
  expectBodyEditParts(after, before);
  await reopenDocx(page, input, path, 'Edited ' + original);
  await verifyOrigins(path);
  const label = local ? 'Revenue' : 'Cell 2.2';
  await input.evaluate((el, label) => { const at = el.value.indexOf(label); if (at < 0) throw new Error('Missing cell'); el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select')); }, label);
  await page.keyboard.insertText('Updated ');
  const cellPath = saved('annual-cell-edit'); await download(page, cellPath);
  await reopenDocx(page, input, cellPath, ('Edited ' + original).replace(label, 'Updated ' + label));
  expect(errors).toEqual([]);
});

test('previews unsupported row exceptions as read-only with the original available', async ({ page }, info) => {
  await page.goto('/playground.html');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toBeVisible();
  const original = await input.inputValue(), parts = unzipSync(readFileSync('public/fixtures/annual-report.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:tblPrEx>', '<w:tblPrEx><w:tblW w:w="1000" w:type="dxa"/>'));
  await openReadOnlyPreview(page, { name: 'unsupported.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

});

test('resizes sparse columns and authors row height after margin exceptions, then saves and reopens', async ({ page }, info) => {
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/annual-report.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/Annual report features/);
  const original = await input.inputValue();
  const select = () => input.evaluate(el => { const at = el.value.indexOf('Cell 1.1'); el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select')); });
  await select(); await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Table properties', exact: true }).click();
  await page.getByLabel('Table indent (in)', { exact: true }).fill('-0.125');
  await page.getByLabel('Column width (in)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Row height', exact: true });
  await dialog.getByLabel('Row height setting').selectOption('atLeast');
  await dialog.getByLabel('Minimum row height (pt)').fill('72');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  const path = info.outputPath('annual-table-format.docx'); await download(page, path);
  await reopenDocx(page, input, path, original); await select();
  await expect((await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true })).toHaveAttribute('title', 'Row height: At least 72 pt');
  await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Table properties', exact: true }).click();
  await expect(page.getByLabel('Table indent (in)', { exact: true })).toHaveValue('-0.125');
  await expect(page.getByLabel('Column width (in)', { exact: true })).toHaveValue('1');
});
