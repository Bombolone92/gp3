import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const fixture = 'tests/fixtures/theme-domain-colors/control.docx';
const native = JSON.parse(readFileSync('tests/fixtures/theme-domain-colors/reference.json', 'utf8'));

test('paired color control retains native drawing colors through editing, export and reopening', async ({ page }, info) => {
  test.setTimeout(240000);
  const source = unzipSync(readFileSync(fixture)), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(fixture);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Cross-domain color controls 1/, { timeout: 180000 });
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const original = await input.inputValue();
  expect(original.match(/C\d{3}/g)).toHaveLength(32);
  const check = async () => {
    const samples = native.rows.flatMap((row, index) => ['drawingRgbFloor', 'drawingSchemeFloor', 'drawingRgbCeil'].map(role => ({
      page: Math.floor(index / 16), label: row.label, role, ...row.observed[role],
    })));
    const actual = await page.evaluate(samples => samples.map(sample => {
      const canvas = document.querySelectorAll('canvas.canvas-page')[sample.page];
      const [x, y, width, height] = sample.bounds;
      return [...canvas.getContext('2d').getImageData(Math.round((x + width / 2) * canvas.width / 612),
        Math.round((y + height / 2) * canvas.height / 792), 1, 1).data].slice(0, 3);
    }), samples);
    for (const [index, sample] of samples.entries()) expect(actual[index], `${sample.label} ${sample.role}`).toEqual(sample.rgb);
  };
  const save = async (name, edited) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx');
    await (await pending).saveAs(path);
    const parts = unzipSync(readFileSync(path));
    expect(Object.keys(parts).sort()).toEqual(Object.keys(source).sort());
    for (const key of Object.keys(source)) if (!edited || key !== 'word/document.xml') expect(parts[key], key).toEqual(source[key]);
    return path;
  };
  await check();
  await save('noedit', false);
  await input.focus(); await input.press('ControlOrMeta+Home');
  await page.keyboard.insertText('Edited ');
  await expect(input).toHaveValue('Edited ' + original);
  const edited = await save('edited', true);
  await check();
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);
  await save('undo', false); await check();
  await reopenDocx(page, input, edited, 'Edited ' + original, { timeout: 180000 });
  await check();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await check();
  await page.locator('canvas.canvas-page').first().screenshot({ path: info.outputPath('drawing-swatches.png') });
  expect(errors).toEqual([]);
});
