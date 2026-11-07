import { expect, test } from '@playwright/test';
import { boot, idle, menu, openImage } from './helpers';

// Layer → Copy CSS and Copy SVG put code for the selected layers on the clipboard.
test('copies CSS and SVG for selected layers from the Layer menu', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await openImage(page, 320, 200, '#3366cc', 'card.png');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { closedPath, liveKnots } = await import('/src/features/vector/geometry.ts');
    const { shapeLayer } = await import('/src/features/vector/state.ts');
    const live = { kind: 'rect' as const, x: 20, y: 30, width: 120, height: 60, radii: [8, 8, 8, 8] as [number, number, number, number] };
    const l = shapeLayer(e.doc, 'Call To Action', { paths: [closedPath(liveKnots(live))] }, { rgb: [1, 0.5, 0], space: 'srgb' }, undefined, live);
    e.command('New Shape', (d) => d.layers.push(l));
    e.selectLayers([l.id]);
    e.update();
  });
  await idle(page);
  await menu(page, 'Layer', 'Copy CSS');
  await expect(page.locator('#status')).toContainText('CSS copied to the clipboard (1 rule)');
  const css = await page.evaluate(() => navigator.clipboard.readText());
  expect(css).toContain('.call-to-action {');
  expect(css).toContain('background-color: #ff8000;');
  expect(css).toContain('border-radius: 8px 8px 8px 8px;');
  expect(css).toContain('left: 20px;');

  // Both layers: the shape as a path, the photo embedded as PNG data.
  await page.evaluate(() => {
    const e = window.photoStudio;
    e.selectLayers(e.doc.layers.map((l) => l.id));
    e.update();
  });
  await menu(page, 'Layer', 'Copy SVG');
  await expect(page.locator('#status')).toContainText('SVG copied to the clipboard (2 layers');
  const svg = await page.evaluate(() => navigator.clipboard.readText());
  expect(svg).toContain('viewBox="0 0 320 200"');
  expect(svg).toContain('fill="#ff8000"');
  expect(svg).toMatch(/<image x="0" y="0" width="320" height="200" preserveAspectRatio="none" href="data:image\/png;base64,iVBOR/);
  // The markup is a valid SVG document.
  const valid = await page.evaluate((text) => !new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror'), svg);
  expect(valid).toBe(true);
});
