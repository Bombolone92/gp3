import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('formatted page fields expose their source boundaries at the printed glyph edges', async ({ page }) => {
  await page.goto('/playground.html');
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument, caretRect, hitTestStop } = await import('/src/engine/layout.js');
    const { layoutPageStories } = await import('/src/engine/page-story-layout.js');
    const { pageStorySelectionLayout } = await import('/src/engine/page-story-positions.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d'), measure = (text, style) => measureCanvasText(ctx, text, style);
    const body = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories);
    const stories = layoutPageStories(body, pkg.pageStories, [...pkg.paragraphs.filter(p => p.sectionEnd).map(p => p.sectionEnd), pkg.pageSettings], measure, pkg.numbering, { styles: pkg.styles });
    const checks = [];
    for (const { path, page: physical, positions } of stories.positions) {
      const selection = pageStorySelectionLayout(body, stories, path, physical);
      const displayed = { ...selection, lines: stories.lines.filter(line => line.pageStory === path && line.page === physical) };
      for (const field of positions) {
        if (field.start === field.end) continue;
        for (const side of ['Start', 'End']) {
          const source = field['source' + side], display = field[side.toLowerCase()];
          const a = caretRect(selection, source, 'forward', physical), b = caretRect(displayed, display, 'forward', physical);
          checks.push({ source, hit: hitTestStop(selection, physical, a.x, a.y + a.height / 2).offset, delta: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) });
        }
      }
    }
    return checks;
  }, [...readFileSync('public/fixtures/general-page-fields.docx')]);
  expect(result.length).toBeGreaterThan(20);
  for (const check of result) { expect(check.delta).toBeLessThan(.001); expect(check.hit).toBe(check.source); }
});
