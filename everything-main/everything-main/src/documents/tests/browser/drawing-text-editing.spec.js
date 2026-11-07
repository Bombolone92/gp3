import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const sources = ['tests/fixtures/drawing-text-editing/control.docx', 'tests/fixtures/drawing-text-alternates/control.docx', 'tests/fixtures/drawing-text-metadata/control.docx', 'tests/fixtures/drawing-placeholder-refs/temporary.docx'];
test.setTimeout(180000);
const download = async (page, info, name) => {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(name); await (await event).saveAs(path); return path;
};
for (const source of sources) test(`rich drawing drafts apply, repaint, cancel, export, and undo: ${source.includes('placeholder') ? 'temporary placeholder references' : source.includes('metadata') ? 'branch metadata' : source.includes('alternates') ? 'alternate branches' : 'plain frames'}`, async ({ page }, info) => {
  await page.goto('/playground.html');
  const old = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect.poll(() => old.evaluate(e => e.isConnected)).toBe(false);
  const input = page.getByRole('textbox', { name: 'Document text', exact: true });
  const body = await input.inputValue();
  const geometry = await page.evaluate(async bytes => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, { ...pkg, images });
    try { return editor.layout.lines.flatMap(l => l.fragments.filter(f => f.image).map(f => ({ x: f.x + 20, y: l.baseline - f.ascent + 15 }))); }
    finally { editor.destroy(); host.remove(); }
  }, [...readFileSync(source)]);
  const open = async (drawing, frame = 1) => {
    const b = await page.locator('canvas.canvas-page').first().boundingBox();
    await page.mouse.click(b.x + geometry[drawing].x, b.y + geometry[drawing].y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit drawing text', exact: true }).hover();
    await page.getByRole('menuitem', { name: `Text frame ${frame}`, exact: true }).click();
    return page.getByRole('dialog', { name: 'Edit drawing text', exact: true });
  };
  const before = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL());
  for (const [drawing, length, replacement] of [[0, 10, 'Updated'], [1, 4, 'Revised']]) {
    const dialog = await open(drawing), draft = dialog.getByRole('textbox', { name: 'Drawing text' });
    await draft.evaluate((e, length) => { e.setSelectionRange(0, length); e.dispatchEvent(new Event('select')); }, length);
    await page.keyboard.insertText(replacement);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toBeHidden(); expect(await input.inputValue()).toBe(body);
  }
  expect(await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL())).not.toBe(before);
  const saved = await download(page, info, 'drawing-text-edited.docx');
  const texts = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes));
    const frames = []; const visit = n => { if (n.text) frames.push(n.text.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n')); n.children?.forEach(visit); };
    Object.values(pkg.assets).filter(a => a.scene).forEach(a => visit(a.scene)); return frames;
  }, [...readFileSync(saved)]);
  expect(texts).toEqual([`${source.includes('placeholder') ? 'Updated' : 'Updated title'}\nOriginal second paragraph`, 'Revised grouped title\nOriginal second paragraph', 'Right grouped title\nOriginal second paragraph']);
  if (source.includes('alternates') || source.includes('metadata') || source.includes('placeholder')) {
    const branches = await page.evaluate(async bytes => {
      const { unzipSync, strFromU8 } = await import('/node_modules/fflate/esm/browser.js');
      const doc = new DOMParser().parseFromString(strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml']), 'application/xml');
      const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006', w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      return [...doc.getElementsByTagNameNS(mc, 'AlternateContent')[0].children].map(branch => [...branch.getElementsByTagNameNS(w, 't')].map(n => n.textContent).join(''));
    }, [...readFileSync(saved)]);
    const title = source.includes('placeholder') ? 'Updated' : 'Updated title';
    expect(branches).toEqual([`${title}Original second paragraph`, `${title}Original second paragraph`]);
  }
  const dialog = await open(1, 2), draft = dialog.getByRole('textbox', { name: 'Drawing text' });
  await draft.press('ControlOrMeta+a'); await page.keyboard.insertText('Discarded draft');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toBeHidden();
  expect(unzipSync(readFileSync(await download(page, info, 'drawing-text-cancel.docx')))).toEqual(unzipSync(readFileSync(saved)));
  await page.screenshot({ path: info.outputPath('drawing-text-applied.png'), fullPage: true });
  await input.press('ControlOrMeta+z'); await input.press('ControlOrMeta+z');
  expect(unzipSync(readFileSync(await download(page, info, 'drawing-text-undo.docx')))).toEqual(unzipSync(readFileSync(source)));
  await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
