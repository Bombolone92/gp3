import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const root = 'tests/fixtures/empty-control-drag/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
async function open(page, readOnly = false) {
  await page.goto('/playground.html');
  await page.evaluate(async ({ bytes, readOnly }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const host = document.createElement('div'); host.id = 'drag-editor';
    host.style.cssText = 'position:fixed;inset:0;overflow:auto;background:white;z-index:1000';
    document.body.append(host);
    window.dragPackage = await DocxPackage.open(new Uint8Array(bytes)); window.dragErrors = [];
    window.dragEditor = new CanvasEditor(host, { ...window.dragPackage, readOnly, onError: e => window.dragErrors.push(e.message) });
  }, { bytes: [...readFileSync(root + reference.source)], readOnly });
  return page.locator('#drag-editor textarea');
}
async function point(page, position, dx = 0) {
  return page.evaluate(async ({ position, dx }) => {
    const { caretRect } = await import('/src/engine/layout.js'), e = window.dragEditor;
    const c = caretRect(e.selectionLayout, position), r = e.canvases[c.page].getBoundingClientRect();
    return { x: r.left + c.x * e.zoom + dx, y: r.top + (c.y + c.height / 2) * e.zoom };
  }, { position, dx });
}
async function save(page, info, name) {
  const bytes = new Uint8Array(await page.evaluate(async () => [...new Uint8Array(await window.dragEditor.export(window.dragPackage).arrayBuffer())]));
  writeFileSync(info.outputPath(name + '.docx'), bytes); return unzipSync(bytes);
}
for (const ref of reference.cases) for (const steps of [1, 12]) test(`drag ${ref.name} with ${steps} moves restores the native prompt and outside caret`, async ({ page }, info) => {
  for (const [file, hash] of [[reference.source, reference.sourceSha256], [ref.result, ref.resultSha256]])
    expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(hash);
  const input = await open(page), parts = unzipSync(readFileSync(root + reference.source));
  await expect(input).toHaveValue('AD'); expect(await save(page, info, 'noedit')).toEqual(parts);
  const entry = await point(page, 1), target = ref.name === 'before' ? await point(page, 0, -3) : await point(page, 2, 100);
  await page.mouse.click(entry.x, entry.y);
  await page.mouse.move(entry.x, entry.y); await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps }); await page.mouse.up();
  await expect(input).toHaveValue('A     D');
  expect(await page.evaluate(() => window.dragEditor.model.selection.anchor === window.dragEditor.model.selection.focus)).toBe(true);
  await page.keyboard.insertText('X'); await expect(input).toHaveValue(ref.text);
  expect(await page.evaluate(async () => {
    const { contentControlRanges } = await import('/src/engine/content-controls.js'), d = window.dragEditor.model, r = contentControlRanges(d.paragraphs)[0];
    return { text: d.text.slice(r.start, r.end), placeholder: !!r.control.placeholder, markerOwned: !!d.paragraphs.flatMap(p => p.runs).find(r => r.text.includes('X')).contentControl };
  })).toEqual({ text: ref.controlText, placeholder: ref.placeholder, markerOwned: false });
  const edited = await save(page, info, 'edited');
  for (const [name, bytes] of Object.entries(parts)) if (name !== 'word/document.xml') expect(edited[name]).toEqual(bytes);
  expect(await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const p = await DocxPackage.open(new Uint8Array(bytes)); return p.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
  }, [...readFileSync(info.outputPath('edited.docx'))])).toBe(ref.text);
  await input.press('Control+z'); await input.press('Control+z'); await expect(input).toHaveValue('AD');
  expect(await save(page, info, 'undo')).toEqual(parts);
  await input.press('Control+y'); await input.press('Control+y'); await expect(input).toHaveValue(ref.text);
  expect(await page.evaluate(() => window.dragErrors)).toEqual([]);
});

test('stationary and cancelled empty-control drags preserve the package', async ({ page }, info) => {
  const input = await open(page), entry = await point(page, 1);
  await page.mouse.click(entry.x, entry.y); await page.mouse.move(entry.x, entry.y); await page.mouse.down();
  await page.mouse.move(entry.x + 0.1, entry.y); await page.mouse.up();
  expect(await page.evaluate(() => window.dragEditor.model.selection.controlCaret?.side)).toBe('inside');
  await page.mouse.down(); const after = await point(page, 2, 100); await page.mouse.move(after.x, after.y);
  await page.evaluate(() => window.dragEditor.pages.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
  await page.mouse.up(); await expect(input).toHaveValue('AD');
  expect(await save(page, info, 'cancelled')).toEqual(unzipSync(readFileSync(root + reference.source)));
  expect(await page.evaluate(() => window.dragEditor.session.history.length)).toBe(0);
});

for (const readOnly of [false, true]) test(`ordinary selection and read-only guards: ${readOnly}`, async ({ page }, info) => {
  const input = await open(page, readOnly), before = await point(page, 0, -3), after = await point(page, 2, 100);
  await page.mouse.move(before.x, before.y); await page.mouse.down(); await page.mouse.move(after.x, after.y, { steps: 12 }); await page.mouse.up();
  expect(await input.evaluate(e => e.value.slice(e.selectionStart, e.selectionEnd))).toBe('AD');
  if (readOnly) {
    const entry = await point(page, 1); await page.mouse.click(entry.x, entry.y);
    await page.mouse.down(); await page.mouse.move(after.x, after.y, { steps: 12 }); await page.mouse.up();
  }
  await expect(input).toHaveValue('AD');
  expect(await save(page, info, 'preserved')).toEqual(unzipSync(readFileSync(root + reference.source)));
  expect(await page.evaluate(() => window.dragEditor.session.history.length)).toBe(0);
});

test('a document edit during capture invalidates the empty drag owner', async ({ page }) => {
  const input = await open(page), entry = await point(page, 1);
  await page.mouse.move(entry.x, entry.y); await page.mouse.down();
  // Keyboard or external commands can change the document while a pointer is
  // captured. Never restore a stale wrapper into the edited document.
  await page.keyboard.insertText('X'); await expect(input).toHaveValue('AXD');
  const after = await point(page, 3, 100);
  await page.mouse.move(after.x, after.y); await page.mouse.up();
  await expect(input).toHaveValue('AXD');
  expect(await page.evaluate(() => window.dragEditor.session.history.length)).toBe(1);
  expect(await page.evaluate(() => window.dragErrors)).toEqual([]);
});
