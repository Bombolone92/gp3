import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/table-property-recovery/';
const names = ['table-bidi', 'row-revision', 'cell-fit', 'table-spacing', 'combined', 'style-cell-fit', 'conditional-cell-fit'];

test('unsupported table properties keep supported geometry, formatting and pixels', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries([...names, 'healthy', 'style-supported', 'conditional-supported'].map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
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
    return Object.entries(rendered).filter(([name]) => !['healthy', 'style-supported', 'conditional-supported'].includes(name)).map(([name, result]) => {
      const baseline = rendered[name === 'style-cell-fit' ? 'style-supported' : name === 'conditional-cell-fit' ? 'conditional-supported' : 'healthy'];
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

test('the recovered table stays read-only and downloads the original package', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  await openReadOnlyPreview(page, `${folder}combined.docx`);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/Retained table cell/);
  await page.getByText('Unsupported features detected (3)', { exact: true }).click();
  for (const feature of ['Right-to-left table layout', 'Tracked table-row insertions', 'Text fitted to table-cell width']) {
    await expect(page.getByText(feature, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('table-property-recovery.png'), fullPage: true });
});
