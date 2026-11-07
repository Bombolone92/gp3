import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root = 'tests/fixtures/embedded-fonts/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
async function layout(page, bytes) {
  return page.evaluate(async source => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, setCanvasFontAlternatives, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { displayedFont } = await import('/tools/font-availability-modules.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(source), c => c.charCodeAt(0))); await validateCanvasLayout(pkg);
    const ctx = document.createElement('canvas').getContext('2d'); setCanvasFontAlternatives(ctx, pkg.styles.fontAlternatives);
    const result = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { styles: pkg.styles });
    return { readOnly: !!pkg.readOnly, font: displayedFont(pkg.paragraphs[0].runs[0], pkg.styles.fontAlternatives), pages: result.pages.length, rows: result.lines.filter(l => !l.virtual).map(l => ({ text: l.fragments.map(f => f.text).join('').trimEnd(), x: l.stops[0].x * .75, baseline: l.baseline * .75, page: l.page, glyphs: l.stops.filter(s => s.offset < l.end).map(s => s.x * .75) })) };
  }, Buffer.from(bytes).toString('base64'));
}
for (const [name, ref] of Object.entries(reference)) test(`embedded ${name} follows native selection, spacing and package preservation`, async ({ page }, info) => {
  test.setTimeout(120000);
  for (const [file, hash] of Object.entries(ref.sha256)) expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(hash);
  const source = root + name + '.docx', bytes = readFileSync(source);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^1 Hamburg/); await expect(input).toBeEditable();
  const actual = await layout(page, bytes);
  writeFileSync(info.outputPath('actual.json'), JSON.stringify(actual, null, 2));
  expect(actual.font).toMatch(name === 'installed-name' ? /^Arial$/ : /^Canvas embedded font /);
  expect(actual.pages).toBe(ref.pages.length);
  expect(actual.rows.map(l => l.text)).toEqual(ref.pages.flat().map(l => l.text));
  if (name === 'installed-name') {
    const ordinary = unzipSync(bytes);
    ordinary['word/fontTable.xml'] = strToU8(strFromU8(ordinary['word/fontTable.xml']).replaceAll(/<w:embed[^>]+\/>/g, ''));
    // Installed Arial's pre-existing glyph-spacing difference is independent
    // of embedded fonts. Assert exact invariance against the same plain file.
    expect(await layout(page, zipSync(ordinary))).toEqual(actual);
  }
  for (let i = 0; i < actual.rows.length; i++) {
    const row = actual.rows[i], native = ref.pages.flat()[i];
    expect(Math.abs(row.baseline - native.baseline), `line ${i} baseline`).toBeLessThan(.2);
    expect(Math.abs(row.x - native.x), `line ${i} x`).toBeLessThan(.15);
    if (name !== 'installed-name') for (let j = 0; j < native.glyphs.length; j++) expect(Math.abs(row.glyphs[j] - native.glyphs[j]), `line ${i} glyph ${j}`).toBeLessThan(.35);
  }
  await page.locator('canvas.canvas-page').first().screenshot({ path: info.outputPath('rendered.png') });
  const original = await input.inputValue(), parts = unzipSync(bytes);
  const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('EDIT ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const file of Object.keys(parts)) if (file !== 'word/document.xml') expect(changed[file]).toEqual(parts[file]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'EDIT ' + original); await expect(input).toBeEditable();
  await expect(page.locator('#playground-error')).toBeEmpty();
});
test('sequential documents with the same font name retain independent faces', async ({ page }) => {
  await page.goto('/playground.html');
  const a = readFileSync(root + 'four-faces.docx'), b = readFileSync(root + 'second-family.docx');
  const first = await layout(page, a), second = await layout(page, b), again = await layout(page, a);
  expect(first.font).not.toBe(second.font); expect(again).toEqual(first);
  expect(first.rows[0].glyphs.at(-1)).not.toBe(second.rows[0].glyphs.at(-1));
});
test('unusable embedded fonts use the declared alternative and never fetch external targets', async ({ page }) => {
  await page.goto('/playground.html');
  const requests = []; page.on('request', request => { if (request.url().includes('example.invalid')) requests.push(request.url()); });
  const parts = unzipSync(readFileSync(root + 'four-faces.docx'));
  parts['word/_rels/fontTable.xml.rels'] = strToU8(strFromU8(parts['word/_rels/fontTable.xml.rels']).replaceAll(/Target="[^"]+"/g, 'Target="https://example.invalid/font.ttf" TargetMode="External"'));
  expect((await layout(page, zipSync(parts))).font).toBe('Courier New'); expect(requests).toEqual([]);
});
test('preview-only embedded faces render read-only without changing the original package', async ({ page }) => {
  await page.goto('/playground.html');
  const parts = unzipSync(readFileSync(root + 'raw-font.docx'));
  for (const [name, bytes] of Object.entries(parts)) if (name.endsWith('.ttf')) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < v.getUint16(4); i++) if (v.getUint32(12 + 16 * i) === 0x4f532f32) v.setUint16(v.getUint32(20 + 16 * i) + 8, 4);
  }
  const bytes = zipSync(parts);
  const result = await layout(page, bytes); expect(result.readOnly).toBe(true); expect(result.font).toMatch(/^Canvas embedded font /);
  await page.getByLabel('Open DOCX file').setInputFiles({ name: 'preview.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes) });
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^1 Hamburg/); await expect(input).not.toBeEditable();
});
test('the font picker names and applies the document font without exposing private aliases', async ({ page }) => {
  await page.goto('/playground.html');
  await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const { openFontPicker } = await import('/src/views/font-picker.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0))); await loadCanvasFonts(pkg);
    const anchor = document.createElement('button'); document.body.prepend(anchor);
    openFontPicker({ anchor, value: 'Codex Embedded Fixture', alternatives: pkg.styles.fontAlternatives, apply: name => { window.appliedFont = name; } });
  }, readFileSync(root + 'four-faces.docx').toString('base64'));
  const choice = page.getByRole('button', { name: 'Codex Embedded Fixture In this document', exact: true });
  await expect(choice).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Current font: Codex Embedded Fixture' })).toBeVisible();
  await expect(page.getByText(/Canvas embedded font/)).toHaveCount(0);
  await choice.click(); await expect.poll(() => page.evaluate(() => window.appliedFont)).toBe('Codex Embedded Fixture');
});
