import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/continuous-numbering-recovery/';
const variants = ['restart-zero', 'restart-even', 'restart-odd', 'combined'];

test('a continuous numbering restart retains rich content and warns about continued numbering', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Document text' }).waitFor({ state: 'attached' });
  const inputs = Object.fromEntries(['healthy', ...variants].map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  const results = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
      rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, assets: images.size, issues: pkg.previewIssues || [], errors,
        pixels: editor.canvases.map(c => c.toDataURL()),
        headerText: editor.storyLayout.lines.map(l => l.fragments.map(f => f.text || '').join('')),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold })) })) };
      if (pkg.readOnly) { try { pkg.export(); } catch (error) { rendered[name].exportError = error.message; } }
      editor.destroy(); host.remove();
    }
    const control = rendered.healthy;
    return Object.entries(rendered).filter(([name]) => name !== 'healthy').map(([name, actual]) => ({ name,
      ...actual, pixels: undefined, geometry: undefined, editableControl: !control.readOnly,
      samePixels: JSON.stringify(actual.pixels) === JSON.stringify(control.pixels),
      sameGeometry: JSON.stringify(actual.geometry) === JSON.stringify(control.geometry) }));
  }, inputs);
  for (const result of results) {
    expect(result.readOnly).toBe(true); expect(result.editableControl).toBe(true);
    expect(result.tables).toBe(1); expect(result.assets).toBe(2); expect(result.errors).toEqual([]);
    expect(result.samePixels).toBe(true); expect(result.sameGeometry).toBe(true);
    expect(result.headerText).toEqual(['Retained header page 1', 'Retained header page 2', 'Retained header page 7']);
    expect(result.exportError).toBeTruthy();
    expect(result.issues.some(m => m.startsWith('Section 2:') && m.includes('numbering continues'))).toBe(true);
    expect(result.issues).not.toContain('Page-number restarts in continuous sections are not supported yet.');
    if (result.name === 'combined') expect(result.issues.some(m => m.includes('shading'))).toBe(true);
  }
  await openReadOnlyPreview(page, `${folder}combined.docx`);
  await page.locator('summary').filter({ hasText: 'Unsupported features detected' }).click();
  await expect(page.getByText(/Section 2: page-number restart at 10.*numbering continues/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('continuous-numbering-recovery.png'), fullPage: true });
});
