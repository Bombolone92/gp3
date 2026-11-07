import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/alternate-run-recovery/';
const cases = ['before', 'after', 'both'].flatMap(p => ['choice', 'fallback', 'empty'].map(b => `${p}-${b}`));
for (const zoom of [1, .75]) test(`selected alternate run branches preserve rendering at ${zoom}`, async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(cases.flatMap(n => ['wrapped', 'matched'].map(k => [`${n}-${k}`, [...readFileSync(folder + `${n}-${k}.docx`)]])));
  const results = await page.evaluate(async ({ inputs, cases, zoom }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [], editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      try {
        editor.setZoom(zoom);
        rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, errors,
          pictures: [...editor.model.paragraphs, ...Object.values(pkg.pageStories.stories).flatMap(s => s.paragraphs)].flatMap(p => p.runs).filter(r => r.image && r.bold && r.link).length,
          pixels: editor.canvases.map(c => c.toDataURL()),
          geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
            fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold, italic: f.italic })) })) };
      } finally { editor.destroy(); host.remove(); }
    }
    return cases.map(name => {
      const a = rendered[name + '-wrapped'], b = rendered[name + '-matched'];
      return { name, editableControl: !b.readOnly, readOnly: a.readOnly, tables: a.tables, pictures: a.pictures, errors: a.errors,
        samePixels: JSON.stringify(a.pixels) === JSON.stringify(b.pixels), sameGeometry: JSON.stringify(a.geometry) === JSON.stringify(b.geometry) };
    });
  }, { inputs, cases, zoom });
  writeFileSync(info.outputPath('comparison.json'), JSON.stringify({ zoom, results }, null, 2));
  for (const r of results) {
    expect(r.editableControl).toBe(true); expect(r.readOnly).toBe(true);
    expect(r.tables).toBe(1); expect(r.pictures).toBe(r.name.endsWith('empty') ? 4 : r.name.startsWith('both') ? 12 : 8);
    expect(r.errors).toEqual([]); expect(r.samePixels, r.name).toBe(true); expect(r.sameGeometry, r.name).toBe(true);
  }
  for (const branch of ['choice', 'fallback', 'empty']) await openReadOnlyPreview(page, folder + `both-${branch}-wrapped.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  const original = await input.inputValue(); await input.focus(); await input.press('ControlOrMeta+End'); await input.press('x');
  expect(await input.inputValue()).toBe(original);
  await page.locator('.canvas-message summary').click();
  await expect(page.getByText(/Alternate run content.*selected branch/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('recovery.png'), fullPage: true });
});
