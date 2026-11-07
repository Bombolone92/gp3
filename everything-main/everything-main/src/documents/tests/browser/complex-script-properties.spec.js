import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const root = 'tests/fixtures/complex-script-properties/', source = root + 'control.docx';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
test('preserves dormant complex-script properties while Latin layout matches the native reference', async ({ page }, info) => {
  test.setTimeout(120000);
  for (const [name, key] of [['control.docx','sourceSha256'], ['native.pdf','pdfSha256']]) expect(createHash('sha256').update(readFileSync(root + name)).digest('hex')).toBe(reference[key]);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toBeVisible();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(input).toHaveValue(/^Default Latin text/);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(pkg.pageSettings));
    return layout.lines.map(l => ({ text: l.fragments.map(f => f.text).join(''), baseline: l.baseline*.75, x: l.fragments[0].x*.75, styles: l.fragments.map(f => [f.fontFamily,f.fontSize,f.bold,f.italic]) }));
  }, readFileSync(source).toString('base64'));
  expect(actual.map(l => l.text)).toEqual(reference.pages[0].map(l => l.text));
  for (const [i, line] of actual.entries()) {
    expect(Math.abs(line.baseline - reference.pages[0][i].baseline)).toBeLessThan(.25);
    expect(Math.abs(line.x - reference.pages[0][i].x)).toBeLessThan(.2);
    expect(line.styles).toEqual([['Arial',10,false,false]]);
    expect(reference.pages[0][i].fonts).toEqual([{ name:'ArialMT', size:9.960000038146973, weight:400 }]);
  }
  await page.locator('canvas.canvas-page').screenshot({ path: info.outputPath('rendered.png') });
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name:'Download .docx', exact:true }).click(); const path = info.outputPath(name+'.docx'); await (await event).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.evaluate(el => { const at = el.value.indexOf('Direct') + 3; el.setSelectionRange(at,at); el.dispatchEvent(new Event('select', { bubbles:true })); });
  await input.focus(); await page.keyboard.insertText('EDIT');
  const edited = await save('edited'), editedParts = unzipSync(readFileSync(edited));
  const xml = strFromU8(editedParts['word/document.xml']);
  expect(xml).toContain('w:szCs w:val="39"');
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(editedParts[name], name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, original.replace('Direct','DirEDITect'));
  expect(errors).toEqual([]);
});
