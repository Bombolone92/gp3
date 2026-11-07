import { test, expect } from '@playwright/test';
import { onTab } from './helpers/editor-tools.js';

test('Multiple Pages shows pages side by side, places the caret on the page clicked and ends with another zoom', async ({ page }) => {
  await page.goto('/playground.html');
  await page.getByRole('button', { name: 'Across pages', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' });
  const canvases = page.locator('canvas.canvas-page');
  await expect(canvases).toHaveCount(2);
  const button = (await onTab(page, 'view')).locator('.ribbon-card').getByRole('button', { name: 'Multiple Pages', exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const [first, second] = [await canvases.nth(0).boundingBox(), await canvases.nth(1).boundingBox()];
  expect(Math.abs(first.y - second.y)).toBeLessThan(1);
  expect(second.x).toBeGreaterThan(first.x + first.width);
  // Clicking the right-hand page's text puts the caret on page 2.
  await page.mouse.click(second.x + second.width / 2, second.y + second.height * 0.12);
  await expect(page.locator('.ed-statusbar')).toContainText('Page 2 of 2');
  await page.mouse.click(first.x + first.width / 2, first.y + first.height * 0.3);
  await expect(page.locator('.ed-statusbar')).toContainText('Page 1 of 2');
  await page.locator('.ribbon-card').getByRole('button', { name: '100%', exact: true }).click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const [a, b] = [await canvases.nth(0).boundingBox(), await canvases.nth(1).boundingBox()];
  expect(b.y).toBeGreaterThan(a.y + a.height);
  await expect(input).toBeFocused();
});
