import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/section-alignment-recovery/';
const variants = ['columns-center', 'columns-bottom', 'columns-both', 'columns-combined', 'continuous-center'];

test('alignment recovery preserves rich sections and supported alignment elsewhere', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(['columns-top', 'continuous-top', ...variants].map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  const results = await page.evaluate(async ({ inputs, variants }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
      rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, assets: images.size, issues: pkg.previewIssues || [], errors,
        pages: editor.canvases.length, pixels: editor.canvases.map(c => c.toDataURL()),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, column: l.column, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold })) })) };
      editor.destroy(); host.remove();
    }
    return variants.map(name => {
      const actual = rendered[name], control = rendered[name.startsWith('columns') ? 'columns-top' : 'continuous-top'];
      return { name, readOnly: actual.readOnly, editableControl: !control.readOnly, tables: actual.tables, assets: actual.assets,
        pages: actual.pages, issues: actual.issues, errors: actual.errors,
        samePixels: JSON.stringify(actual.pixels) === JSON.stringify(control.pixels),
        sameGeometry: JSON.stringify(actual.geometry) === JSON.stringify(control.geometry) };
    });
  }, { inputs, variants });
  for (const result of results) {
    expect(result.readOnly).toBe(true); expect(result.editableControl).toBe(true);
    expect(result.pages).toBe(2); expect(result.tables).toBe(1); expect(result.assets).toBe(2);
    expect(result.errors).toEqual([]); expect(result.samePixels).toBe(true); expect(result.sameGeometry).toBe(true);
    expect(result.issues.some(message => message.startsWith('Section 1:') && message.includes('shown at the top'))).toBe(true);
    expect(result.issues).not.toContain('Vertical page alignment with columns or continuous sections is not supported yet.');
    if (result.name === 'columns-combined') expect(result.issues.some(message => message.includes('shading'))).toBe(true);
  }
  await openReadOnlyPreview(page, `${folder}columns-combined.docx`);
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('section-alignment-recovery.png'), fullPage: true });
});
