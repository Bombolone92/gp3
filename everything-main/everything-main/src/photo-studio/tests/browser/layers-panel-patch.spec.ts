// The Layers panel patches its rows (ui/patch-list.ts): unchanged rows keep
// their elements across updates, changed rows are rebuilt, and rows touched
// by other code (an inline rename) come back from their markup.
import { test, expect } from '@playwright/test';
import { boot, idle, openImage, run } from './helpers';

test('unchanged layer rows keep their elements; changed and edited rows are rebuilt', async ({ page }) => {
  await boot(page);
  await openImage(page, 300, 200);
  for (let i = 0; i < 3; i++) await run(page, 'layer.new-quick');
  const ids = await page.evaluate(() => window.photoStudio.doc.layers.map((l) => l.id));
  // Tag every row element, then refresh the workspace without changes.
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('#layers .layer-row').forEach((r) => ((r as unknown as { __tag: string }).__tag = r.dataset.row!)));
  const tagged = () =>
    page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#layers .layer-row')].map((r) => [r.dataset.row, (r as unknown as { __tag?: string }).__tag ?? null]));
  await page.evaluate(() => window.photoStudio.update());
  expect((await tagged()).every(([id, tag]) => id === tag)).toBe(true);

  // Selecting another layer rebuilds only the two rows whose selection changed.
  await page.evaluate((id) => window.photoStudio.selectLayer(id), ids[1]);
  const after = await tagged();
  expect(after.filter(([, tag]) => tag === null).map(([id]) => id).sort()).toEqual([ids[1], ids[3]].sort());
  await expect(page.locator(`#layers .layer-row[data-row="${ids[1]}"]`)).toHaveClass(/selected/);
  await expect(page.locator(`#layers .layer-row.selected`)).toHaveCount(1);

  // Escape from an inline rename restores the name even though nothing changed.
  const name = await page.evaluate((id) => window.photoStudio.doc.layers.find((l) => l.id === id)!.name, ids[1]);
  await page.locator(`#layers .layer-row[data-row="${ids[1]}"] .layer-name`).dblclick();
  const input = page.locator('#layers input.layer-rename');
  await expect(input).toBeVisible();
  await input.fill('Draft name');
  await input.press('Escape');
  await expect(page.locator('#layers input.layer-rename')).toHaveCount(0);
  await expect(page.locator(`#layers .layer-row[data-row="${ids[1]}"] .name-text`)).toHaveText(name);

  // Renaming for real updates the row, and the order follows the document.
  await page.locator(`#layers .layer-row[data-row="${ids[1]}"] .layer-name`).dblclick();
  await page.locator('#layers input.layer-rename').fill('Renamed');
  await page.locator('#layers input.layer-rename').press('Enter');
  await idle(page);
  await expect(page.locator(`#layers .layer-row[data-row="${ids[1]}"] .name-text`)).toHaveText('Renamed');
  await run(page, 'layer.bring-front');
  const order = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#layers .layer-row')].map((r) => r.dataset.row));
  expect(order).toEqual(await page.evaluate(() => [...window.photoStudio.doc.layers].reverse().map((l) => l.id)));
});
