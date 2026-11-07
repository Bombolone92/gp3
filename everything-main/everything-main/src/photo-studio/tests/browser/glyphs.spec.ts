import { test, expect } from '@playwright/test';
import { boot, idle, openImage, panel, run } from './helpers';

const text = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const { session } = (window as unknown as { photoStudioType: typeof import('../../src/features/type/session') }).photoStudioType;
    const { plainText } = await import('/src/imaging/text/model.ts');
    return session ? plainText(session.data.content) : null;
  });

test('Glyphs panel lists the font’s characters and inserts them into text', async ({ page }) => {
  await boot(page);
  await openImage(page, 400, 200, '#ffffff');
  await page.evaluate(() => window.photoStudio.runCommand('type.add'));
  await expect.poll(() => text(page)).toBe('');
  await page.keyboard.type('Cafe');
  await expect.poll(() => text(page)).toBe('Cafe');
  // Remove the plain "e" and insert "é" from the Glyphs panel.
  await page.keyboard.press('Backspace');
  await page.evaluate(() => window.photoStudio.dock.show('glyphs'));
  const body = await panel(page, 'Glyphs');
  await expect(body.locator('select[aria-label="Font family"]')).toHaveValue('Inter');
  const cell = body.locator('.gl-grid [data-cp="233"]');
  await expect(cell).toBeVisible();
  expect(await body.locator('.gl-grid .gl-cell').count()).toBeGreaterThan(200);
  await cell.dblclick();
  await expect.poll(() => text(page)).toBe('Café');
  // The glyph joins Recently Used and the filter narrows the grid.
  await expect(body.locator('.gl-recent [data-cp="233"]')).toHaveCount(1);
  await body.locator('select[aria-label="Show"]').selectOption('currency');
  await expect(body.locator('.gl-grid [data-cp="8364"]')).toHaveCount(1);
  await expect(body.locator('.gl-grid [data-cp="65"]')).toHaveCount(0);
  await body.locator('.gl-grid [data-cp="8364"]').dblclick();
  await expect.poll(() => text(page)).toBe('Café€');
  // Committing keeps the inserted characters in the layer.
  await run(page, 'select.deselect-layers');
  await idle(page);
  const layerText = await page.evaluate(() => window.photoStudio.doc.layers.find((l) => l.kind === 'text')?.text);
  expect(layerText).toBe('Café€');
});
