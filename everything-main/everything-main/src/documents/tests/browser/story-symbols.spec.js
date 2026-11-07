import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/story-symbols/';

test('renders page-story symbols like explicit glyph runs and matches native advances', async ({ page }, info) => {
  test.setTimeout(180000);
  const ref = JSON.parse(readFileSync(folder + 'reference.json'));
  for (const [name, hash] of [['before-symbol.docx', ref.sourceSha256], ['native.pdf', ref.pdfSha256]]) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const inputs = Object.fromEntries(['before', 'after', 'both'].flatMap(p => ['symbol', 'literal'].map(k => `${p}-${k}`)).map(n => [n, [...readFileSync(folder + n + '.docx')]]));
  const result = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { fontAvailable } = await import('/src/engine/font-availability.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [], editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      try {
        const lines = [...editor.layout.lines, ...editor.storyLayout.lines];
        rendered[name] = { readOnly: !!pkg.readOnly, errors, pages: editor.canvases.length,
          pixels: editor.canvases.map(c => c.toDataURL()),
          advances: lines.flatMap(l => l.fragments.filter(f => f.text === '\uf031').map(f => f.width * .75)) };
      } finally { editor.destroy(); host.remove(); }
    }
    return { native: fontAvailable('Wingdings'), advances: rendered['before-symbol'].advances,
      cases: ['before', 'after', 'both'].map(n => ({ name: n, readOnly: rendered[n + '-symbol'].readOnly,
        errors: rendered[n + '-symbol'].errors, pages: rendered[n + '-symbol'].pages,
        samePixels: JSON.stringify(rendered[n + '-symbol'].pixels) === JSON.stringify(rendered[n + '-literal'].pixels) })) };
  }, inputs);
  writeFileSync(info.outputPath('comparison.json'), JSON.stringify(result, null, 2));
  for (const c of result.cases) { expect(c.readOnly).toBe(false); expect(c.errors).toEqual([]); expect(c.pages).toBe(1); expect(c.samePixels, c.name).toBe(true); }
  expect(result.advances).toHaveLength(4);
  if (result.native) for (const [i, advance] of result.advances.entries()) expect(Math.abs(advance - ref.symbols[i].advance)).toBeLessThan(.2);
  else info.annotations.push({ type: 'native fonts', description: 'Wingdings is required for native symbol advance comparison.' });
  await page.getByLabel('Open DOCX file').setInputFiles(folder + 'before-symbol.docx');
  await expect(page.getByRole('textbox', { name: 'Document text', exact: true })).toHaveJSProperty('readOnly', false);
  const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL());
  writeFileSync(info.outputPath('page.png'), Buffer.from(png.split(',')[1], 'base64'));
});

test('edits symbols in both page stories with exact undo and edited reopen', async ({ page }, info) => {
  test.setTimeout(180000);
  const source = folder + 'before-symbol.docx', parts = unzipSync(readFileSync(source));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const area = page.getByRole('combobox', { name: 'Editing area', exact: true });
  const body = page.getByRole('textbox', { name: 'Document text', exact: true });
  await expect(body).toHaveValue(/Styled heading/); const originalBody = await body.inputValue();
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const originals = {};
  for (const kind of ['header', 'footer']) {
    await area.selectOption(JSON.stringify([`word/${kind}1.xml`, 0]));
    const input = page.getByRole('textbox', { name: kind === 'header' ? 'Header text' : 'Footer text', exact: true });
    await expect(input).toHaveJSProperty('readOnly', false); originals[kind] = await input.inputValue();
    await input.evaluate(e => { const at = e.value.indexOf('\ufffc') + 1; e.focus(); e.setSelectionRange(at, at); e.dispatchEvent(new Event('select', { bubbles: true })); });
    await page.keyboard.insertText('Z');
    expect(await input.inputValue()).toBe(originals[kind].replace('\ufffc', '\ufffcZ'));
  }
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const [name, bytes] of Object.entries(parts)) if (!['word/header1.xml', 'word/footer1.xml'].includes(name)) expect(changed[name]).toEqual(bytes);
  for (const kind of ['header', 'footer']) expect(strFromU8(changed[`word/${kind}1.xml`]).match(/<w:sym\b/g)).toHaveLength(1);
  await page.getByRole('textbox', { name: 'Footer text', exact: true }).press('ControlOrMeta+z');
  await expect(page.getByRole('textbox', { name: 'Footer text', exact: true })).toHaveValue(originals.footer);
  await page.getByRole('textbox', { name: 'Footer text', exact: true }).press('ControlOrMeta+z');
  await expect(page.getByRole('textbox', { name: 'Header text', exact: true })).toHaveValue(originals.header);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await area.selectOption(''); await reopenDocx(page, body, edited, originalBody);
  for (const kind of ['header', 'footer']) {
    await area.selectOption(JSON.stringify([`word/${kind}1.xml`, 0]));
    await expect(page.getByRole('textbox', { name: kind === 'header' ? 'Header text' : 'Footer text', exact: true })).toHaveValue(originals[kind].replace('\ufffc', '\ufffcZ'));
  }
  expect(errors).toEqual([]);
});
