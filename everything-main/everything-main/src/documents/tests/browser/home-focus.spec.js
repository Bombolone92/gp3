import { test, expect } from '@playwright/test';

test('the document list starts reading at its heading without drawing a focus ring on it', async ({ page }) => {
  await page.goto('/mock.html#/home');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeFocused();
  expect(await heading.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  // Controls reached with the keyboard keep their visible focus.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.matches('button, input, a') && getComputedStyle(document.activeElement).outlineStyle)).toBe('solid');
});
