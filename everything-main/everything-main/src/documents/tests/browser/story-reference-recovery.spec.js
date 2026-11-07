import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/story-reference-recovery/';
const names = ['missing-header', 'external-header', 'duplicate-header', 'missing-footer'];

test('broken story references retain other story geometry and pixels', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries([...names, 'blank-header', 'blank-footer'].map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  const results = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const editor = new CanvasEditor(host, { ...pkg, images });
      rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, issues: pkg.previewIssues,
        pixels: editor.canvases.map(c => c.toDataURL()),
        geometry: editor.layout.lines.map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, fontSize: f.fontSize, bold: f.bold })) })) };
      editor.destroy(); host.remove();
    }
    return Object.entries(rendered).filter(([name]) => !name.startsWith('blank-')).map(([name, result]) => {
      const baseline = rendered[name === 'missing-footer' ? 'blank-footer' : 'blank-header'];
      return { name, readOnly: result.readOnly, baselineEditable: !baseline.readOnly, tables: result.tables, issues: result.issues,
        samePixels: JSON.stringify(result.pixels) === JSON.stringify(baseline.pixels), sameGeometry: JSON.stringify(result.geometry) === JSON.stringify(baseline.geometry) };
    });
  }, inputs);
  for (const result of results) {
    expect(result.readOnly, result.name).toBe(true); expect(result.baselineEditable, result.name).toBe(true);
    expect(result.tables, result.name).toBe(1); expect(result.issues.length, result.name).toBeGreaterThan(0);
    expect(result.sameGeometry, result.name).toBe(true); expect(result.samePixels, result.name).toBe(true);
  }
});

test('broken story references remain disclosed and original downloads are preserved', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  await openReadOnlyPreview(page, `${folder}missing-header.docx`);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/Retained table cell/);
  await page.getByText('Unsupported features detected (1)', { exact: true }).click();
  for (const feature of ['A missing header part']) {
    await expect(page.getByText(feature, { exact: true })).toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('story-reference-recovery.png'), fullPage: true });
});
