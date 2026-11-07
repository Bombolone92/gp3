import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/karla-family/', source = folder + 'control.docx';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));

test('reviewed Karla restores four-style native layout and preserves editing', async ({ page }, info) => {
  for (const [name, hash] of Object.entries(reference.sha256)) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex'), name).toBe(hash);
  const requests = [];
  page.on('request', r => { if (/\/fonts\/Karla-/.test(r.url())) requests.push(r.url()); });
  await page.goto('/playground.html');
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Regular:/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const actual = await page.evaluate(async encoded => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { fontAvailable } = await import('/src/engine/font-availability.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))); await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (text, style) => measureCanvasText(ctx, text, style), pageGeometry(pkg.pageSettings));
    return { available: fontAvailable('Karla'), lines: layout.lines.map(l => ({ text: l.fragments.map(f => f.text).join('').trimEnd(), x: l.fragments[0].x * .75, baseline: l.baseline * .75 })) };
  }, readFileSync(source).toString('base64'));
  expect(actual.available).toBe(true); expect(actual.lines).toHaveLength(reference.rows.length);
  for (const [i, row] of actual.lines.entries()) {
    expect(row.text).toBe(reference.rows[i].text);
    expect(Math.abs(row.x - reference.rows[i].x), `case ${i} origin`).toBeLessThan(.2);
    expect(Math.abs(row.baseline - reference.rows[i].baseline), `case ${i} baseline`).toBeLessThan(.2);
  }
  // Installed Karla keeps priority. If assets are needed, only this family's
  // two reviewed, same-origin files may be fetched. Existing synthesis probes
  // can issue a second request for the same URL; their cost is tracked separately.
  const urls = [...new Set(requests)];
  if (urls.length) expect(urls.map(url => new URL(url).pathname).sort()).toEqual(['/fonts/Karla-Bold.ttf', '/fonts/Karla-Regular.ttf']);
  for (const url of urls) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  const parts = unzipSync(readFileSync(source)), original = await input.inputValue();
  const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'Edited ' + original);
  await expect(input).toHaveJSProperty('readOnly', false); await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
});
