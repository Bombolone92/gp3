import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const root = 'tests/fixtures/empty-control-story-end/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
async function open(page, source, zoom, readOnly = false) {
  await page.goto('/playground.html');
  await page.evaluate(async ({ bytes, zoom, readOnly }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const host = document.createElement('div'); host.id = 'story-end-editor';
    host.style.cssText = 'position:fixed;inset:0;overflow:auto;background:white;z-index:1000'; document.body.append(host);
    window.edgePackage = await DocxPackage.open(new Uint8Array(bytes)); window.edgeErrors = [];
    window.edgeEditor = new CanvasEditor(host, { ...window.edgePackage, readOnly, onError: e => window.edgeErrors.push(e.message) });
    window.edgeEditor.zoom = zoom; window.edgeEditor.relayout();
  }, { bytes: [...readFileSync(root + source)], zoom, readOnly });
  return page.locator('#story-end-editor textarea');
}
async function point(page, position, dx) {
  return page.evaluate(async ({ position, dx }) => {
    const { caretRect } = await import('/src/engine/layout.js'), e = window.edgeEditor;
    const c = caretRect(e.selectionLayout, position), r = e.canvases[c.page].getBoundingClientRect();
    return { x: r.left + (c.x + dx) * e.zoom, y: r.top + (c.y + c.height / 2) * e.zoom };
  }, { position, dx });
}
async function click(page, position, dx) { const p = await point(page, position, dx); await page.mouse.click(p.x, p.y); }
async function save(page, info, name) {
  const bytes = new Uint8Array(await page.evaluate(async () => [...new Uint8Array(await window.edgeEditor.export(window.edgePackage).arrayBuffer())]));
  writeFileSync(info.outputPath(name + '.docx'), bytes); return unzipSync(bytes);
}
for (const zoom of [1, .75]) for (const ref of reference.cases) test(`story end ${ref.name} at zoom ${zoom} matches native ownership`, async ({ page }, info) => {
  for (const [name, hash] of [[ref.source, ref.sourceSha256], [ref.result, ref.resultSha256]])
    expect(createHash('sha256').update(readFileSync(root + name)).digest('hex')).toBe(hash);
  const input = await open(page, ref.source, zoom), original = await input.inputValue(), parts = unzipSync(readFileSync(root + ref.source));
  expect(await save(page, info, 'noedit')).toEqual(parts);
  if (ref.drag) {
    const start = await point(page, ...ref.points[0]), end = await point(page, ...ref.points[1]);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
  } else for (const [position, dx] of ref.points) await click(page, position, dx);
  await page.keyboard.insertText(ref.marker); await expect(input).toHaveValue(ref.text);
  expect(await page.evaluate(async () => {
    const { contentControlRanges } = await import('/src/engine/content-controls.js'), e = window.edgeEditor;
    return contentControlRanges(e.model.paragraphs).map(r => ({ text: e.model.text.slice(r.start, r.end), placeholder: !!r.control.placeholder }));
  })).toEqual(ref.controls);
  const edited = await save(page, info, 'edited');
  for (const [name, bytes] of Object.entries(parts)) if (name !== 'word/document.xml') expect(edited[name]).toEqual(bytes);
  expect(await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const p = await DocxPackage.open(new Uint8Array(bytes));
    return p.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
  }, [...readFileSync(info.outputPath('edited.docx'))])).toBe(ref.text);
  for (let i = 0; i <= ref.restorations; i++) await input.press('Control+z');
  await expect(input).toHaveValue(original); expect(await save(page, info, 'undo')).toEqual(parts);
  for (let i = 0; i <= ref.restorations; i++) await input.press('Control+y');
  await expect(input).toHaveValue(ref.text); expect(await page.evaluate(() => window.edgeErrors)).toEqual([]);
});

test('read-only same-offset exit preserves the package and history', async ({ page }, info) => {
  const source = '../empty-control-home-end/trailing.docx', input = await open(page, source, 1, true);
  await click(page, 1, -.6); await click(page, 1, 85.6);
  await expect(input).toHaveValue('A');
  expect(await page.evaluate(() => window.edgeEditor.session.history.length)).toBe(0);
  expect(await save(page, info, 'readonly')).toEqual(unzipSync(readFileSync(root + source)));
});

for (const key of ['Shift', 'Control', 'Alt', 'Meta']) for (const drag of [false, true]) test(`${key} ${drag ? 'drag' : 'click'} at the same offset retains the existing non-restoring path`, async ({ page }, info) => {
  const source = '../empty-control-home-end/trailing.docx', input = await open(page, source, 1);
  await click(page, 1, -.6);
  const start = await point(page, 1, -.6), end = await point(page, 1, 85.6);
  if (drag) {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
  }
  await page.keyboard.down(key);
  try { if (drag) await page.mouse.up(); else await page.mouse.click(end.x, end.y); }
  finally { await page.keyboard.up(key); }
  await expect(input).toHaveValue('A');
  expect(await page.evaluate(() => window.edgeEditor.session.history.length)).toBe(0);
  expect(await save(page, info, 'modified')).toEqual(unzipSync(readFileSync(root + source)));
});
