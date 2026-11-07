import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { reopenDocx } from './helpers/reopen-docx.js';

test('paints fractional straight borders with one native coverage calculation at every zoom', async ({ page }) => {
 await page.goto('/playground.html');
 const differences = await page.evaluate(async () => {
  const { paintParagraphBorder } = await import('/src/engine/canvas-paragraph-borders.js');
  const differences = [];
  for (const zoom of [.75, 1, 1.25, 2]) for (const horizontal of [true, false]) for (const offset of [0, .125, .5, .75]) {
   const c = document.createElement('canvas'), r = document.createElement('canvas'); c.width = r.width = c.height = r.height = 64;
   const a = c.getContext('2d'), b = r.getContext('2d'); a.scale(zoom, zoom); b.scale(zoom, zoom);
   const stroke = { x: 4.125 + offset, y: 5.375 + offset, width: horizontal ? 16.5 : 2 / 3, height: horizontal ? 2 / 3 : 16.5, horizontal, border: { style: 'single', color: '15435B' } };
   paintParagraphBorder(a, stroke); b.fillStyle = '#15435B'; b.fillRect(stroke.x, stroke.y, stroke.width, stroke.height);
   const actual = a.getImageData(0, 0, 64, 64).data, expected = b.getImageData(0, 0, 64, 64).data;
   if (actual.some((v, i) => v !== expected[i])) differences.push({ zoom, horizontal, offset });
  }
  return differences;
 });
 expect(differences).toEqual([]);
});

test('rasterizes corner intersections and exact-cell clipping once, retaining full dots and multi-line bands', async ({ page }) => {
 await page.goto('/playground.html');
 const failures = await page.evaluate(async () => {
  const { paintParagraphBorder } = await import('/src/engine/canvas-paragraph-borders.js');
  const failures = [], color = '#15435B';
  const cases = [
   { name: 'slanted corner', stroke: { x: 4.25, y: 5.125, width: 20, height: 2, clip: [[4.25, 5.125], [24.25, 5.125], [22.25, 7.125], [6.25, 7.125]] }, expected: ctx => { ctx.beginPath(); ctx.moveTo(4.25, 5.125); ctx.lineTo(24.25, 5.125); ctx.lineTo(22.25, 7.125); ctx.lineTo(6.25, 7.125); ctx.closePath(); ctx.fill(); } },
   { name: 'cell crop', stroke: { x: 4.25, y: 5.125, width: 20, height: 2, cellClip: { top: 5.5, bottom: 6.75 } }, expected: ctx => ctx.fillRect(4.25, 5.5, 20, 1.25) },
   { name: 'double', style: 'double', stroke: { x: 4.25, y: 5.125, width: 20, height: 2 }, expected: ctx => { ctx.fillRect(4.25, 5.125, 20, 2 / 3); ctx.fillRect(4.25, 5.125 + 4 / 3, 20, 2 / 3); } },
   { name: 'triple', style: 'triple', stroke: { x: 4.25, y: 5.125, width: 20, height: 2 }, expected: ctx => { for (const offset of [0, .8, 1.6]) ctx.fillRect(4.25, 5.125 + offset, 20, .4); } },
   { name: 'whole dots', style: 'dotted', crop: [8, 4, 12, 6], stroke: { x: 4, y: 5.125, width: 24, height: 2 }, expected: ctx => { for (let x = 5; x < 28; x += 4) { ctx.beginPath(); ctx.arc(x, 6.125, 1, 0, 2 * Math.PI); ctx.fill(); } } },
  ];
  for (const item of cases) {
   const canvases = [document.createElement('canvas'), document.createElement('canvas')]; for (const c of canvases) { c.width = 40; c.height = 20; }
   const [a, b] = canvases.map(c => c.getContext('2d'));
   paintParagraphBorder(a, { ...item.stroke, horizontal: true, border: { style: item.style || 'single', color: '15435B' } });
   b.fillStyle = color; item.expected(b); const crop = item.crop || [0, 0, 40, 20], actual = a.getImageData(...crop).data, expected = b.getImageData(...crop).data;
   if (actual.some((v, i) => v !== expected[i])) failures.push(item.name);
  }
  return failures;
 });
 expect(failures).toEqual([]);
});


test('renders independent fractional paragraph and cell borders, edits text, and preserves declarations on reopen', async ({ page }, info) => {
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/border-coverage.docx');
 const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Thin borders/); const text = await input.inputValue();
 writeFileSync(info.outputPath('border-coverage.png'), Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
 await input.evaluate(el => { el.focus(); el.setSelectionRange(0, 'Thin borders'.length); el.dispatchEvent(new Event('select')); }); await page.keyboard.insertText('Edited thin borders');
 const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const saved = info.outputPath('border-coverage.docx'); await (await pending).saveAs(saved);
 await reopenDocx(page, input, saved, text.replace('Thin borders', 'Edited thin borders'));
 await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1.5');
 writeFileSync(info.outputPath('border-coverage-zoom.png'), Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
 expect(errors).toEqual([]);
});
