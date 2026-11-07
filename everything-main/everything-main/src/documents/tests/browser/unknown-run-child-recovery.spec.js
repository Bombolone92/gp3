import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';

const folder = 'tests/fixtures/unknown-run-child-recovery/';
const names = ['before', 'after', 'both'].flatMap(p => ['unsupported', 'matched'].map(k => `${p}-${k}`));

for (const zoom of [1, .75]) test(`unknown run children retain surrounding rendering at ${zoom}`, async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(names.map(n => [n, [...readFileSync(folder + n + '.docx')]]));
  const results = await page.evaluate(async ({ inputs, zoom }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [], editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      try {
        editor.setZoom(zoom);
        rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, errors, issues: pkg.previewIssues || [],
          pictures: [...editor.model.paragraphs, ...Object.values(pkg.pageStories.stories).flatMap(s => s.paragraphs)].flatMap(p => p.runs).filter(r => r.image && r.bold && r.link).length,
          pixels: editor.canvases.map(c => c.toDataURL()),
          geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
            fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold, italic: f.italic })) })) };
      } finally { editor.destroy(); host.remove(); }
    }
    return ['before', 'after', 'both'].map(position => {
      const a = rendered[position + '-unsupported'], b = rendered[position + '-matched'];
      return { position, editableControl: !b.readOnly, readOnly: a.readOnly, issues: a.issues, tables: a.tables, pictures: a.pictures, errors: a.errors,
        samePixels: JSON.stringify(a.pixels) === JSON.stringify(b.pixels), sameGeometry: JSON.stringify(a.geometry) === JSON.stringify(b.geometry) };
    });
  }, { inputs, zoom });
  writeFileSync(info.outputPath('comparison.json'), JSON.stringify({ zoom, results }, null, 2));
  for (const r of results) {
    expect(r.editableControl).toBe(true); expect(r.readOnly).toBe(true);
    expect(r.tables).toBe(1); expect(r.pictures).toBe(4); expect(r.errors).toEqual([]);
    expect(r.samePixels, r.position).toBe(true); expect(r.sameGeometry, r.position).toBe(true);
  }
  await openReadOnlyPreview(page, folder + 'both-unsupported.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  const original = await input.inputValue(); await input.focus(); await input.press('ControlOrMeta+End'); await input.press('x');
  expect(await input.inputValue()).toBe(original);
  await page.locator('.canvas-message summary').click();
  await expect(page.getByText(/Unsupported run content w:ruby.*inline text/).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption(String(zoom));
  await page.screenshot({ path: info.outputPath('recovery.png'), fullPage: true });
  if (zoom === 1) for (const position of ['before', 'after']) await openReadOnlyPreview(page, folder + position + '-unsupported.docx');
});
