import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.use({ permissions: ['local-fonts'] });
test('changing the font of beveled text prepares its outlines and preserves undo', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/playground.html');
  const ready = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const { prepareCanvasFont, fontAvailable } = await import('/src/engine/font-availability.js');
    const { preparedText3dFont } = await import('/src/engine/text-3d-fonts.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes));
    await loadCanvasFonts(pkg); await prepareCanvasFont('Times New Roman');
    if (!fontAvailable('Times New Roman')) return false;
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, pkg);
    let start = 0;
    for (const paragraph of pkg.paragraphs) {
      if (paragraph.runs.some(run => run.text3d?.includes('matte'))) break;
      start += paragraph.runs.map(run => run.text || '').join('').length + 1;
    }
    editor.model.select(start, start + 2);
    window.effectEdit = { editor, before: editor.model.snapshot(), preparedText3dFont };
    editor.setRunFormat({ fontAscii: 'Times New Roman' });
    return true;
  }, [...readFileSync('tests/fixtures/text-3d/control.docx')]);
  test.skip(!ready, 'Requires installed Times New Roman; no font binaries are distributed.');
  await expect.poll(() => page.evaluate(() => {
    const {editor, preparedText3dFont} = window.effectEdit;
    return editor.layout.lines.some(line => line.fragments.some(fragment => fragment.fontFamily === 'Times New Roman' && !!preparedText3dFont(fragment)));
  })).toBe(true);
  const result = await page.evaluate(async () => {
    const { editor, before } = window.effectEdit;
    const { paintText3d } = await import('/src/engine/canvas-text-3d.js');
    const fragment = editor.layout.lines.flatMap(line => line.fragments).find(f => f.fontFamily === 'Times New Roman');
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#D02030';
    const painted = paintText3d(ctx, fragment.text, 20, 200, fragment);
    editor.undo();
    const restored = JSON.stringify(editor.model.paragraphs) === JSON.stringify(before.paragraphs);
    editor.destroy();
    return { painted, restored };
  });
  expect(result).toEqual({ painted: true, restored: true });
});
