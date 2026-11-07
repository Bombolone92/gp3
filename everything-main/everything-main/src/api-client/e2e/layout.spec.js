import { test, expect } from '@playwright/test';
import { mockApi, openApp, axeViolations } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

/** Opens a request with a wide sidebar and the code snippet panel, as a returning user might have left them. */
async function wideSidebarWithCode(page) {
  await page.addInitScript(() => localStorage.setItem('api-client:prefs', JSON.stringify({ sidebarWidth: 520, rightPanel: 'code', lastOpened: Date.now() })));
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/layout');
}

const width = (page, selector) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().width);

test('keeps room for the editor in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await wideSidebarWithCode(page);
  expect(await width(page, '.tab-content')).toBeGreaterThanOrEqual(360);
  await expect(page.getByRole('combobox', { name: 'Request URL' })).toBeInViewport();
  // The sidebar gives way when the window shrinks after start, and takes its width back when it grows.
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect.poll(() => width(page, '.sidebar')).toBe(520);
  expect(await width(page, '.right-panel')).toBe(380);
  await page.setViewportSize({ width: 920, height: 800 });
  await expect.poll(() => width(page, '.tab-content')).toBeGreaterThanOrEqual(360);
  const sep = page.getByRole('separator', { name: 'Resize sidebar' });
  expect(Number(await sep.getAttribute('aria-valuenow'))).toBe(Math.round(await width(page, '.sidebar')));
});

test('keeps focus in the sidebar drawer on phones and returns it to the menu button @mobile', async ({ page }) => {
  await openApp(page);
  const menu = page.getByRole('button', { name: 'Open sidebar' });
  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect.poll(() => page.evaluate(() => document.activeElement.closest('#sidebar') !== null)).toBe(true);
  expect(await axeViolations(page)).toEqual([]);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.closest('#sidebar') !== null)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  // The scrim and the drawer's own close button return focus too.
  await menu.click();
  await page.locator('.scrim').click({ position: { x: 395, y: 300 } });
  await expect(menu).toBeFocused();
  // The scrim covers the menu button, so tapping it again closes the drawer as before.
  await menu.click();
  const box = await menu.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await drawer.getByRole('button', { name: 'Close sidebar' }).click();
  await expect(menu).toBeFocused();
  // The page behind is usable again.
  await page.getByRole('button', { name: 'New request' }).first().click();
  await expect(page.getByRole('combobox', { name: 'Request URL' })).toBeFocused();
});

test('reports the console height it really has in a short window', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 520 });
  await openApp(page);
  await page.getByRole('button', { name: 'Console' }).click();
  const sep = page.getByRole('separator', { name: 'Resize console' });
  await sep.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowUp');
  const height = await page.locator('#console').evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(Number(await sep.getAttribute('aria-valuenow')) - height)).toBeLessThanOrEqual(1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.locator('#console').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(height - 5);
});

test('fits the header on narrow phones without overlapping controls @mobile', async ({ page }) => {
  for (const w of [320, 360, 390, 440]) {
    await page.setViewportSize({ width: w, height: 700 });
    await openApp(page);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('.appbar-menu, .appbar-brand img, .appbar-title, .appbar-search, .appbar-actions > *')]
        .map((e) => ({ left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().left + Math.max(e.scrollWidth, e.getBoundingClientRect().width), shown: e.getBoundingClientRect().width > 2 }))
        .filter((b) => b.shown),
    );
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].left, `at ${w}px`).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
    expect(boxes.at(-1).right).toBeLessThanOrEqual(w);
    // The name stays for screen readers when only the logo shows.
    await expect(page.getByRole('heading', { level: 1, name: 'API Client' })).toHaveCount(1);
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible();
  }
});

test('keeps Send, Save and the URL usable with the code panel open at laptop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/layout');
  await page.getByRole('button', { name: /code snippet/i }).first().click();
  await expect(page.locator('.right-panel')).toBeVisible();
  // Nothing lies over the controls: each is what the page has at its center.
  for (const target of [page.getByRole('button', { name: /^Send/ }).first(), page.getByRole('button', { name: 'Save', exact: true }), page.getByRole('combobox', { name: 'Request URL' })]) {
    const hit = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(hit).toBe(true);
  }
});

test('shows the code snippet on phones as a sheet that Escape closes @mobile', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/phone');
  const more = page.getByRole('button', { name: 'More send options' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Show code snippet' }).click();
  const panel = page.getByRole('complementary', { name: 'Code snippet' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('https://api.test/phone');
  await expect(panel.getByRole('button', { name: 'Copy code' })).toBeFocused();
  expect(await width(page, '.right-panel')).toBe(await page.evaluate(() => innerWidth));
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(more).toBeFocused();
});

test('shows the response below the request when there is no room beside it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('api-client:prefs', JSON.stringify({ layout: 'side', rightPanel: 'code', sidebarOpen: true, lastOpened: Date.now() })));
  await page.setViewportSize({ width: 1024, height: 760 });
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  const split = page.locator('.req-split');
  await expect(split).not.toHaveClass(/\bside\b/);
  await expect(page.getByRole('separator', { name: 'Resize request and response' })).toHaveAttribute('aria-orientation', 'horizontal');
  // Closing the code panel makes room again.
  await page.getByRole('button', { name: 'Code snippet', exact: true }).click();
  await expect(split).toHaveClass(/\bside\b/);
});

test('lets the keyboard scroll the shortcuts list on phones @mobile', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('?');
  const body = page.getByRole('dialog', { name: 'Keyboard shortcuts' }).locator('.dialog-body');
  await expect(body).toHaveAttribute('tabindex', '0');
  expect((await axeViolations(page)).filter((v) => v.startsWith('scrollable-region-focusable'))).toEqual([]);
});
