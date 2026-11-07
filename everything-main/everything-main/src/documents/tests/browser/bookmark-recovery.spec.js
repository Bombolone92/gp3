import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/bookmark-recovery/';
const variants = ['orphan-start', 'orphan-end', 'reversed', 'duplicate-start', 'duplicate-end', 'unpaired-columns', 'combined'];

test('retains valid bookmark navigation and rich pixels beside broken ranges', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Document text' }).waitFor({ state: 'attached' });
  const inputs = Object.fromEntries(['healthy', ...variants].map(name => [name, readFileSync(`${folder}${name}.docx`).toString('base64')]));
  const results = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, base64] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
      const pixels = editor.canvases.map(c => c.toDataURL()), bookmarks = editor.bookmarks;
      const link = pkg.paragraphs.flatMap(p => p.runs).find(r => r.link?.anchor === 'Cell').link;
      editor.openHyperlink(link);
      rendered[name] = { readOnly: !!pkg.readOnly, issues: pkg.previewIssues || [], errors, pixels,
        bookmarks, target: editor.model.selection.focus, expectedTarget: editor.model.text.indexOf('Retained table cell'),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold })) })) };
      editor.destroy(); host.remove();
    }
    const control = rendered.healthy;
    return Object.entries(rendered).filter(([name]) => name !== 'healthy').map(([name, actual]) => ({ name,
      ...actual, pixels: undefined, geometry: undefined, editableControl: !control.readOnly,
      sameBookmarks: JSON.stringify(actual.bookmarks) === JSON.stringify(control.bookmarks),
      samePixels: JSON.stringify(actual.pixels) === JSON.stringify(control.pixels),
      sameGeometry: JSON.stringify(actual.geometry) === JSON.stringify(control.geometry) }));
  }, inputs);
  for (const result of results) {
    expect(result.readOnly).toBe(true); expect(result.editableControl).toBe(true);
    expect(result.bookmarks).toHaveLength(4); expect(result.sameBookmarks).toBe(true);
    expect(result.target).toBe(result.expectedTarget); expect(result.target).toBeGreaterThan(0);
    expect(result.errors).toEqual([]); expect(result.samePixels).toBe(true); expect(result.sameGeometry).toBe(true);
    expect(result.issues.some(m => m.startsWith('Bookmark 99 in word/document.xml'))).toBe(true);
  }
  await openReadOnlyPreview(page, `${folder}combined.docx`);
  await page.locator('summary').filter({ hasText: 'Unsupported features detected' }).click();
  await expect(page.getByText(/Bookmark 99 in word\/document.xml is unavailable/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('0.5');
  await page.screenshot({ path: info.outputPath('bookmark-recovery.png'), fullPage: true });
});
