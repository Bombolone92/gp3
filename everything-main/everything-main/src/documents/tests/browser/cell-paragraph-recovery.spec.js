import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/cell-paragraph-recovery/';
const variants = ['first', 'second', 'inherited', 'story', 'combined', 'drawing-break'];

test('rejected cell paragraph breaks retain body and header pictures, styles and geometry', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Document text' }).waitFor({ state: 'attached' });
  const inputs = Object.fromEntries(['healthy', 'drawing-healthy', ...variants].map(name => [name, readFileSync(`${folder}${name}.docx`).toString('base64')]));
  const results = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, base64] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
      rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, assets: images.size, issues: pkg.previewIssues || [], errors,
        pages: editor.canvases.length, pixels: editor.canvases.map(c => c.toDataURL()),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold, picture: !!f.image })) })) };
      editor.destroy(); host.remove();
    }
    return Object.entries(rendered).filter(([name]) => !name.endsWith('healthy')).map(([name, actual]) => {
      const control = rendered[name.startsWith('drawing') ? 'drawing-healthy' : 'healthy'];
      return { name,
      ...actual, pixels: undefined, geometry: undefined, editableControl: !control.readOnly,
      samePixels: JSON.stringify(actual.pixels) === JSON.stringify(control.pixels),
      sameGeometry: JSON.stringify(actual.geometry) === JSON.stringify(control.geometry) };
    });
  }, inputs);
  for (const result of results) {
    expect(result.readOnly).toBe(true); expect(result.editableControl).toBe(true);
    const drawing = result.name === 'drawing-break';
    expect(result.pages).toBe(drawing ? 4 : 2); expect(result.tables).toBe(drawing ? 0 : 1); expect(result.assets).toBe(drawing ? 4 : 2);
    expect(result.errors).toEqual([]); expect(result.samePixels).toBe(true); expect(result.sameGeometry).toBe(true);
    expect(result.issues.some(m => m.includes('paragraph page break is ignored'))).toBe(true);
    if (['story', 'combined'].includes(result.name)) expect(result.issues.some(m => m.includes('word/header1.xml'))).toBe(true);
    if (result.name === 'combined') expect(result.issues.some(m => m.includes('shading'))).toBe(true);
  }
  await openReadOnlyPreview(page, `${folder}combined.docx`);
  await page.locator('summary').filter({ hasText: 'Unsupported features detected' }).click();
  await expect(page.getByText(/Table cell in word\/header1.xml: paragraph page break is ignored/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('cell-paragraph-recovery.png'), fullPage: true });
});
