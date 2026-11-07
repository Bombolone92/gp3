import { test, expect } from '@playwright/test';

test('a narrower window folds ribbon groups into drop-down buttons and unfolds them again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  const collapsed = () => page.locator('#ribbon-panel-home .ribbon-group.is-collapsed').evaluateAll(groups => groups.map(g => g.dataset.group));
  await expect.poll(collapsed).toEqual([]);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(async () => (await collapsed()).length).toBeGreaterThan(0);
  // The everyday groups stay open longest, and nothing overflows the card.
  expect(await collapsed()).not.toContain('font');
  expect(await page.locator('#ribbon-panel-home').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // A folded group opens its commands beneath its button and they still work.
  const name = (await collapsed())[0];
  const button = page.locator(`#ribbon-panel-home .ribbon-group[data-group="${name}"] .ribbon-collapsed`);
  await button.click(); await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.ribbon-flyout')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.ribbon-flyout')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect.poll(collapsed).toEqual([]);
});

test('the status bar zoom menu looks and responds like the toolbar menus', async ({ page }) => {
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  expect(await zoom.evaluate(el => [getComputedStyle(el).appearance, getComputedStyle(el).backgroundImage.startsWith('url(')])).toEqual(['none', true]);
  const border = () => zoom.evaluate(el => getComputedStyle(el).borderTopColor);
  const resting = await border(); await zoom.hover();
  await expect.poll(border).not.toBe(resting);
  await zoom.selectOption('1.5'); await expect(zoom).toHaveValue('1.5');
  // Text mode explains itself on hover.
  await expect(page.locator('.canvas-text-mode')).toHaveAttribute('title', /plain text field/);
});

test('a window too narrow for the page at 100% opens at Fit width', async ({ browser }) => {
  for (const [width, expected] of [[800, 'fit'], [1280, '1']]) {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    await page.goto('/mock.html#/new');
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Zoom', exact: true })).toHaveValue(expected);
    expect(await page.locator('.canvas-host').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.close();
  }
});

test('a sideways-scrolling phone ribbon fades at an edge with more commands beyond it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto('/mock.html#/new');
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    const card = page.locator('.ribbon-card');
    await expect(card).toHaveClass(/more-after/); await expect(card).not.toHaveClass(/more-before/);
    await page.locator('#ribbon-panel-home').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await expect(card).toHaveClass(/more-before/); await expect(card).not.toHaveClass(/more-after/);
    await expect(page.getByRole('button', { name: 'Formatting Pane', exact: true })).toBeInViewport();
  } finally { await context.close(); }
});
