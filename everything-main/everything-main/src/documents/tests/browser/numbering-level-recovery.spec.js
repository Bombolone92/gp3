import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/numbering-level-recovery/';

test('rejected numbering levels retain rich paragraphs and supported lists', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(['healthy', 'duplicate-level', 'missing-level-index', 'invalid-level-index', 'duplicate-override', 'missing-override-index', 'invalid-override-index', 'invalid-start'].map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  const results = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
      rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, errors,
        pixels: editor.canvases.map(c => c.toDataURL()),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold })) })) };
      editor.destroy(); host.remove();
    }
    return ['duplicate-level', 'missing-level-index', 'invalid-level-index', 'duplicate-override', 'missing-override-index', 'invalid-override-index', 'invalid-start'].map(name => ({ name,
      editableControl: !rendered.healthy.readOnly, readOnly: rendered[name].readOnly,
      tables: rendered[name].tables, errors: rendered[name].errors,
      samePixels: JSON.stringify(rendered[name].pixels) === JSON.stringify(rendered.healthy.pixels),
      sameGeometry: JSON.stringify(rendered[name].geometry) === JSON.stringify(rendered.healthy.geometry) }));
  }, inputs);
  for (const result of results) {
    expect(result.editableControl).toBe(true); expect(result.readOnly).toBe(true);
    expect(result.tables).toBe(1); expect(result.errors).toEqual([]);
    expect(result.samePixels, result.name).toBe(true); expect(result.sameGeometry, result.name).toBe(true);
  }
  await openReadOnlyPreview(page, `${folder}duplicate-level.docx`);
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('numbering-level-recovery.png'), fullPage: true });
});
