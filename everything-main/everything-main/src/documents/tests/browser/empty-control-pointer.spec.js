import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const root = 'tests/fixtures/empty-control-pointer/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
async function open(page, source, readOnly = false, zoom = 1) {
  await page.goto('/playground.html');
  await page.evaluate(async ({ bytes, readOnly, zoom }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const host = document.createElement('div'); host.id = 'pointer-editor';
    host.style.cssText = 'position:fixed;inset:0;overflow:auto;background:white;z-index:1000';
    document.body.append(host);
    window.pointerPackage = await DocxPackage.open(new Uint8Array(bytes));
    window.pointerErrors = [];
    window.pointerEditor = new CanvasEditor(host, { ...window.pointerPackage, readOnly, onError: e => window.pointerErrors.push(e.message) });
    window.pointerEditor.zoom = zoom; window.pointerEditor.relayout();
  }, { bytes: [...readFileSync(root + source)], readOnly, zoom });
  return page.locator('#pointer-editor textarea');
}
async function point(page, position, dx = 0, dy = 0) {
  return page.evaluate(async ({ position, dx, dy }) => {
    const { caretRect } = await import('/src/engine/layout.js'), e = window.pointerEditor;
    const c = caretRect(e.selectionLayout, position), r = e.canvases[c.page].getBoundingClientRect();
    return { x: r.left + (c.x + dx) * e.zoom, y: r.top + (c.y + c.height / 2 + dy) * e.zoom };
  }, { position, dx, dy });
}
async function click(page, p) { await page.mouse.click(p.x, p.y); }
async function save(page, info, name) {
  const bytes = await page.evaluate(async () => [...new Uint8Array(await window.pointerEditor.export(window.pointerPackage).arrayBuffer())]);
  writeFileSync(info.outputPath(name + '.docx'), new Uint8Array(bytes)); return unzipSync(new Uint8Array(bytes));
}
for (const zoom of [1, 0.75]) for (const ref of reference.cases) test(`pointer ${ref.name} at zoom ${zoom} matches native ownership and undo`, async ({ page }, info) => {
  for (const [file, hash] of [[ref.source, ref.sourceSha256], [ref.result, ref.resultSha256]])
    expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(hash);
  const input = await open(page, ref.source, false, zoom), parts = unzipSync(readFileSync(root + ref.source));
  await expect(input).toHaveValue('AD'); expect(await save(page, info, 'noedit')).toEqual(parts);
  const entry = await point(page, 1); await click(page, entry);
  expect(await page.evaluate(() => window.pointerEditor.model.selection.controlCaret?.side)).toBe('inside');
  await click(page, entry); await expect(input).toHaveValue('AD');
  const target = ref.name === 'before' ? await point(page, 0, -3) : await point(page, 2, 100, ref.name === 'wrapped-below' ? 180 : 0);
  await click(page, target); await page.keyboard.insertText('X'); await expect(input).toHaveValue(ref.text);
  const actual = await page.evaluate(async () => {
    const { contentControlRanges } = await import('/src/engine/content-controls.js'), d = window.pointerEditor.model;
    const r = contentControlRanges(d.paragraphs)[0], typed = d.paragraphs.flatMap(p => p.runs).find(r => r.text.includes('X'));
    return { text: d.text.slice(r.start, r.end), placeholder: !!r.control.placeholder, markerOwned: !!typed.contentControl };
  });
  expect(actual).toEqual({ text: ref.controlText, placeholder: ref.placeholder, markerOwned: false });
  const edited = await save(page, info, 'edited');
  for (const [name, bytes] of Object.entries(parts)) if (name !== 'word/document.xml') expect(edited[name]).toEqual(bytes);
  expect(await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const p = await DocxPackage.open(new Uint8Array(bytes));
    return p.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
  }, [...readFileSync(info.outputPath('edited.docx'))])).toBe(ref.text);
  await input.press('Control+z'); await input.press('Control+z'); await expect(input).toHaveValue('AD');
  expect(await save(page, info, 'undo')).toEqual(parts);
  await input.press('Control+y'); await input.press('Control+y'); await expect(input).toHaveValue(ref.text);
  expect(await page.evaluate(() => window.pointerErrors)).toEqual([]);
});

test('read-only pointer exits never mutate empty controls', async ({ page }, info) => {
  const ref = reference.cases[0], input = await open(page, ref.source, true);
  await click(page, await point(page, 1)); await click(page, await point(page, 2, 100));
  await expect(input).toHaveValue('AD');
  expect(await page.evaluate(() => window.pointerEditor.session.history.length)).toBe(0);
  expect(await save(page, info, 'readonly')).toEqual(unzipSync(readFileSync(root + ref.source)));
});
