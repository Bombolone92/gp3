import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const source = 'tests/fixtures/text-3d/junctions.docx';
const reference = JSON.parse(readFileSync('tests/fixtures/measurements/text-bevel-junctions.json'));
const originalParts = unzipSync(readFileSync(source));
test.use({ deviceScaleFactor: 3, permissions: ['local-fonts'] });
test('synthetic-bold curved numeral retains its unresolved native outline comparison', async ({ page }) => {
  test.setTimeout(120000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  const installed = await page.evaluate(async () => (await window.queryLocalFonts()).map(face => face.family));
  test.skip(!installed.includes('Franklin Gothic Book') || !installed.includes('Arial'), 'Requires installed control fonts.');
  const input = page.getByRole('textbox', { name: 'Document text' }), previous = await input.elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await page.waitForFunction(el => !el.isConnected, previous); await previous.dispose();
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
  await expect(page.locator('#playground-error')).toHaveText('');
  const samples = reference.records.find(r => r.font === 'Franklin Gothic Book' && r.bold && r.text === '4').bad;
  const errors = await page.locator('canvas.canvas-page').nth(5).evaluate((canvas, samples) => {
    const ctx = canvas.getContext('2d'), scale = canvas.width / 612;
    return samples.map(sample => {
      const rgb = ctx.getImageData(Math.round(sample.x * scale), Math.round(sample.y * scale), 1, 1).data;
      return Math.max(...sample.rgb.map((v, i) => Math.abs(v - rgb[i])));
    });
  }, samples);
  expect(errors).toHaveLength(89);
  // Mark only the known visual assertion; loading and font preparation must pass.
  test.fail(true, 'The synthetic-bold 4 outline still differs from the native reference; original cusp controls do not reproduce it.');
  expect(Math.max(...errors)).toBeLessThanOrEqual(3);
});

test('synthetic-bold bevel junction shades smoothly and survives edit, export and undo', async ({ page }, info) => {
  test.setTimeout(120000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  const installed = await page.evaluate(async () => (await window.queryLocalFonts()).map(face => face.family));
  test.skip(!installed.includes('Franklin Gothic Book') || !installed.includes('Arial'), 'Requires installed control fonts.');
  const input = page.getByRole('textbox', { name: 'Document text' }), old = await input.elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await page.waitForFunction(el => !el.isConnected, old); await old.dispose();
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
  await expect(page.locator('#playground-error')).toHaveText('');
  const bad = reference.records.find(r => r.font === 'Franklin Gothic Book' && r.bold && r.text === 'Y').bad;
  const errors = await page.locator('canvas.canvas-page').nth(4).evaluate((canvas, samples) => {
    const ctx = canvas.getContext('2d'), scale = canvas.width / 612;
    return samples.map(sample => {
      const rgb = ctx.getImageData(Math.round(sample.x * scale), Math.round(sample.y * scale), 1, 1).data;
      return Math.max(...sample.rgb.map((v, i) => Math.abs(v - rgb[i])));
    });
  }, bad);
  expect(errors).toHaveLength(91);
  expect(Math.max(...errors)).toBeLessThanOrEqual(3);
  const download = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const target = info.outputPath(name); await (await pending).saveAs(target);
    return unzipSync(readFileSync(target));
  };
  const check = (parts, edited = false) => {
    expect(Object.keys(parts).sort()).toEqual(Object.keys(originalParts).sort());
    for (const name of Object.keys(originalParts))
      if (!edited || name !== 'word/document.xml') expect(Buffer.from(parts[name]).equals(Buffer.from(originalParts[name])), name).toBe(true);
  };
  check(await download('noedit.docx'));
  const original = await input.inputValue();
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  await expect(input).toHaveValue('Edited ' + original); check(await download('edited.docx'), true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); check(await download('undo.docx'));
});
