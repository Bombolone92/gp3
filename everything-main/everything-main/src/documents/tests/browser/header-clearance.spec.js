import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const folder = 'tests/fixtures/header-clearance';
const references = JSON.parse(readFileSync(`${folder}/reference.json`, 'utf8'));
for (const ref of references) test(`matches native signed story clearance: ${ref.name}`, async ({ page }, info) => {
  test.setTimeout(120000);
  const source = `${folder}/${ref.name}.docx`, bytes = readFileSync(source), errors = [];
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/${ref.name}.pdf`)).digest('hex')).toBe(ref.pdfSha256);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/VISUAL/);
  await expect(input).toHaveJSProperty('readOnly', false);
  const geometry = await page.evaluate(async b => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(b), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const placed = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories);
    const borders = placed.tableBorders.filter(b => b.width > b.height).map(b => (b.y + b.height / 2) * .75);
    return { pages: placed.pageCount, top: Math.min(...borders), bottom: Math.max(...borders) };
  }, bytes.toString('base64'));
  expect(geometry.pages).toBe(ref.pages);
  expect(Math.abs(geometry.top - ref.tableTop)).toBeLessThan(.2);
  expect(Math.abs(geometry.bottom - ref.tableBottom)).toBeLessThan(.2);
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
    await expect(page.locator('#playground-error')).toBeEmpty();
  };
  await check();
  writeFileSync(info.outputPath('page.png'), Buffer.from(await page.locator('canvas.canvas-page').last().evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  const original = await input.inputValue(), parts = unzipSync(bytes);
  const save = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+End'); await page.keyboard.insertText(' EDIT');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts); await check();
  await reopenDocx(page, input, edited, original + ' EDIT'); await check();
  expect(errors).toEqual([]);
});
