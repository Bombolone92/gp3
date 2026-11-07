import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source = 'public/fixtures/nested-floating-borders.docx';
const folder = 'tests/fixtures/nested-floating-borders';
const reference = JSON.parse(readFileSync(`${folder}/reference.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`, 'utf8'));

test('includes first-row left ink and all-row right ink in nested floating alignment', async ({ page }, info) => {
  test.setTimeout(120000);
  for (const [name, hash] of Object.entries(manifest.sha256)) {
    expect(createHash('sha256').update(readFileSync(name.endsWith('.docx') ? source : `${folder}/${name}`)).digest('hex')).toBe(hash);
  }
  await page.goto('/playground.html');
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const p = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await loadCanvasFonts(p); const ctx = document.createElement('canvas').getContext('2d');
    const l = layoutDocument(p.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    return { pages: l.pageCount, lines: l.lines.map(line => ({ text: line.fragments.map(f => f.text || '').join(''),
      page: line.page, x: line.stops[0].x * .75, y: line.baseline * .75 })) };
  }, readFileSync(source).toString('base64'));
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify(actual, null, 2));
  expect(actual.pages).toBe(20);
  const shifts = [];
  for (const native of reference) {
    const lines = actual.lines.filter(l => l.page === native.case);
    const shift = lines.find(l => l.text === 'Nested 1').x - native.labels['Nested 1'][0].x;
    shifts.push(shift);
    for (const [label, expected] of Object.entries(native.labels)) {
      const observed = lines.filter(l => l.text === label); expect(observed).toHaveLength(expected.length);
      for (let j = 0; j < expected.length; j++) {
        expect(Math.abs(observed[j].x - (label === 'Following outer table' ? 0 : shift) - expected[j].x), `case ${native.case}, ${label}, x`).toBeLessThan(.12);
        expect(Math.abs(observed[j].y - expected[j].y), `case ${native.case}, ${label}, y`).toBeLessThan(.12);
      }
    }
  }
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/^Nested border case 0/);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(20);
  for (const native of reference) {
    const canvas = page.locator('canvas.canvas-page').nth(native.case);
    await canvas.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bands = await canvas.evaluate((c, fills) => {
      const scale = c.width / 612, ctx = c.getContext('2d');
      return fills.map(fill => {
        const y = Math.floor((fill.y + fill.height - 1) * scale), pixels = ctx.getImageData(0, y, c.width, 1).data;
        let left = Infinity, right = -Infinity;
        for (let x = 0; x < c.width; x++) if ([208, 232, 192].every((v, k) => Math.abs(pixels[x * 4 + k] - v) <= 1)) {
          left = Math.min(left, x / scale); right = Math.max(right, (x + 1) / scale);
        }
        return { left, right };
      });
    }, native.fills);
    expect(bands).toHaveLength(4);
    native.fills.forEach((fill, i) => {
      expect(Math.abs(bands[i].left - shifts[native.case] - fill.x), `case ${native.case}, fill ${i}, left`).toBeLessThan(1);
      expect(Math.abs(bands[i].right - shifts[native.case] - fill.x - fill.width), `case ${native.case}, fill ${i}, right`).toBeLessThan(1);
    });
  }
  const input = page.getByRole('textbox', { name: 'Document text' });
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => {
    const next = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await next).saveAs(path); return unzipSync(readFileSync(path));
  };
  expect(await save('border-noedit')).toEqual(parts);
  const heading = original.indexOf('Nested border case 2\n');
  const start = original.indexOf('Nested 1', original.indexOf('Before nested 1', heading));
  expect(start).toBeGreaterThan(heading);
  await input.evaluate((e, start) => { e.focus(); e.setSelectionRange(start, start); e.dispatchEvent(new Event('select')); }, start);
  await page.keyboard.insertText('X');
  await expect(input).toHaveValue(original.slice(0, start) + 'X' + original.slice(start));
  const changed = await save('border-edited');
  expectBodyEditParts(changed, parts);
  const borders = bytes => new TextDecoder().decode(bytes).match(/<w:tcBorders\b[^>]*>[\s\S]*?<\/w:tcBorders>/g);
  expect(borders(changed['word/document.xml'])).toEqual(borders(parts['word/document.xml']));
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(await save('border-undo')).toEqual(parts);
});
