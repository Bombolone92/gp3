import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/story-field-recovery/';

test('cached story fields retain logos, formatting and live page numbers on both pages', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(['healthy', 'simple', 'complex', 'nested', 'combined'].map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
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
        storyText: editor.canvases.map((_, page) => editor.storyLayout.lines.filter(l => l.page === page).map(l => l.fragments.map(f => f.text).join('')).join(' ').replace(/\s+/g, ' ')),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold })) })) };
      editor.destroy(); host.remove();
    }
    return ['simple', 'complex', 'nested', 'combined'].map(name => ({ name,
      editableControl: !rendered.healthy.readOnly, readOnly: rendered[name].readOnly,
      tables: rendered[name].tables, errors: rendered[name].errors, storyText: rendered[name].storyText,
      samePixels: JSON.stringify(rendered[name].pixels) === JSON.stringify(rendered.healthy.pixels),
      sameGeometry: JSON.stringify(rendered[name].geometry) === JSON.stringify(rendered.healthy.geometry) }));
  }, inputs);
  for (const result of results) {
    expect(result.editableControl).toBe(true); expect(result.readOnly).toBe(true);
    expect(result.tables).toBe(1); expect(result.errors).toEqual([]);
    expect(result.samePixels).toBe(true); expect(result.sameGeometry).toBe(true);
    expect(result.storyText).toHaveLength(2);
    for (const [index, text] of result.storyText.entries()) {
      expect(text.match(new RegExp(`Page ${index + 1} of 2`, 'g'))).toHaveLength(2);
      expect(text).not.toContain('Page 9');
    }
  }
  await openReadOnlyPreview(page, `${folder}nested.docx`);
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('story-field-recovery.png'), fullPage: true });
});
