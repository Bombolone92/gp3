import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';

const folder = 'tests/fixtures/rotated-cell-recovery/';
const names = ['before', 'after', 'both', 'nested', 'stories'];
for (const zoom of [1, 0.75]) test(`rotation recovery preserves healthy cells and page stories at ${zoom}`, async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(names.flatMap(name => [name, `${name}-control`]).map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  const results = await page.evaluate(async ({ inputs, names, zoom }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      editor.setZoom(zoom);
      const lines = [...editor.layout.lines, ...editor.storyLayout.lines];
      rendered[name] = { readOnly: !!pkg.readOnly, errors, tables: pkg.tables.length,
        issues: [...(pkg.previewIssues || []), ...editor.storyLayout.unsupported.map(i => `${i.path}: ${i.message}`)],
        rotated: lines.filter(l => l.cellText).length, storyLines: editor.storyLayout.lines.length,
        pixels: editor.canvases.map(c => c.toDataURL()),
        geometry: lines.map(l => ({ page: l.page, x: l.x, y: l.y, baseline: l.baseline, height: l.height,
          rotation: l.cellText?.matrix, fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width })) })) };
      editor.destroy(); host.remove();
    }
    return names.map(name => {
      const current = rendered[name], control = rendered[`${name}-control`];
      return { name, readOnly: current.readOnly, editableControl: !control.readOnly, errors: current.errors,
        tables: current.tables, rotated: current.rotated, storyLines: current.storyLines, issues: current.issues,
        samePixels: JSON.stringify(current.pixels) === JSON.stringify(control.pixels),
        sameGeometry: JSON.stringify(current.geometry) === JSON.stringify(control.geometry) };
    });
  }, { inputs, names, zoom });
  writeFileSync(info.outputPath('comparisons.json'), JSON.stringify(results, null, 2));
  for (const result of results) {
    expect(result.readOnly, result.name).toBe(true); expect(result.editableControl, result.name).toBe(true);
    expect(result.errors, result.name).toEqual([]); expect(result.tables).toBeGreaterThanOrEqual(3);
    expect(result.rotated, result.name).toBeGreaterThan(0);
    expect(result.samePixels, result.name).toBe(true); expect(result.sameGeometry, result.name).toBe(true);
    expect(result.issues.some(i => i.includes('cell 2:') && i.includes('shown horizontally')), result.name).toBe(true);
    if (result.name === 'stories') {
      expect(result.storyLines).toBeGreaterThan(0);
      for (const part of ['header1.xml', 'footer1.xml']) expect(result.issues.some(i => i.includes(part) && i.includes('shown horizontally'))).toBe(true);
    }
  }
  for (const name of names) await openReadOnlyPreview(page, `${folder}${name}.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  const before = await input.inputValue(); await input.focus(); await input.press('x');
  expect(await input.inputValue()).toBe(before);
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption(String(zoom));
  await page.locator('.canvas-message summary').click();
  await expect(page.getByText(/shown horizontally/).first()).toBeVisible();
  for (const part of ['word/header1.xml', 'word/footer1.xml']) await expect(page.locator('.canvas-message li').filter({ hasText: part }).first()).toContainText('shown horizontally');
  await page.screenshot({ path: info.outputPath('rotated-cell-recovery.png'), fullPage: true });
});
