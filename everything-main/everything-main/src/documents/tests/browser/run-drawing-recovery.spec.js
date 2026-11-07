import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/run-drawing-recovery/';
test('failed same-run drawings retain their frame, visible placeholder and original bytes', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(['reserved', 'drawing', 'alternate'].map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  const results = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const editor = new CanvasEditor(host, { ...pkg, images });
      rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, placeholders: [...images.values()].filter(image => image.previewPlaceholder).length, pixels: editor.canvases.map(c => c.toDataURL()),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold })) })) };
      editor.destroy(); host.remove();
    }
    return ['drawing', 'alternate'].map(prefix => {
      const a = rendered.reserved, b = rendered[prefix];
      return { prefix, editable: !a.readOnly, readOnly: b.readOnly, tables: b.tables, placeholders: b.placeholders,
        samePixels: JSON.stringify(a.pixels) === JSON.stringify(b.pixels), sameGeometry: JSON.stringify(a.geometry) === JSON.stringify(b.geometry) };
    });
  }, inputs);
  for (const result of results) {
    expect(result.editable).toBe(true); expect(result.readOnly).toBe(true);
    expect(result.tables).toBe(1);
    expect(result.sameGeometry).toBe(true); expect(result.samePixels).toBe(false); expect(result.placeholders).toBe(3);
  }
  await openReadOnlyPreview(page, `${folder}alternate.docx`);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/Styled heading/);
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('run-drawing-recovery.png'), fullPage: true });
});
