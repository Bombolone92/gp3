// Workspace chrome conventions: every panel has a flyout menu with the
// standard items, the icon strip is grouped, and the status bar reports.
import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('photo-studio-dock');
  });
  await boot(page);
});

test('every docked panel has a flyout menu; Close and Window → Panels round trip', async ({ page }) => {
  for (const title of ['Color', 'Properties', 'Layers']) await expect(page.getByRole('button', { name: `${title} panel menu` })).toBeVisible();
  await page.getByRole('button', { name: 'Properties panel menu' }).click();
  const menu = page.locator('.context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Collapse to Icon' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-panel-tab="properties"]')).toHaveCount(0);
  await page.evaluate(() => window.photoStudio.runCommand('window.panel.properties'));
  await expect(page.locator('[data-panel-tab="properties"]')).toHaveAttribute('aria-selected', 'true');
});

test('panels move between a tab group and the icon strip from their menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Properties panel menu' }).click();
  await page.locator('.context-menu').getByRole('menuitem', { name: 'Collapse to Icon' }).click();
  const icon = page.locator('[data-strip-panel="properties"]');
  await expect(icon).toBeVisible();
  await icon.click();
  await page.locator('.dock-drawer').getByRole('button', { name: 'Properties panel menu' }).click();
  await page.locator('.context-menu').getByRole('menuitem', { name: 'Dock as Tab' }).click();
  await expect(page.locator('[data-panel-tab="properties"]')).toBeVisible();
});

test('icon strip sections are labelled groups navigable with arrow keys', async ({ page }) => {
  const strip = page.getByRole('toolbar', { name: 'Collapsed panels' });
  await expect(strip.getByRole('group', { name: 'History' }).getByRole('button', { name: 'History', exact: true })).toBeVisible();
  await expect(strip.getByRole('group', { name: 'Painting' }).getByRole('button', { name: 'Brushes' })).toBeVisible();
  const first = strip.getByRole('button').first();
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(strip.getByRole('button').nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(strip.getByRole('button').last()).toBeFocused();
});

test('start screen presets create a document; status bar zoom field and info item', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('photo-studio-status-info'));
  const presets = page.getByRole('region', { name: 'New from a preset' });
  await presets.getByRole('button', { name: /Square social post/ }).click();
  await expect.poll(() => page.evaluate(() => window.photoStudio.hasDocument)).toBe(true);
  await expect(page.locator('#tab-size')).toHaveText('1080 × 1080 px');
  const zoom = page.getByRole('textbox', { name: 'Zoom level' });
  await zoom.fill('50%');
  await zoom.press('Enter');
  await expect.poll(() => page.evaluate(() => Math.round(window.photoStudio.zoom * 100))).toBe(50);
  await expect(zoom).toHaveValue('50%');
  const info = page.locator('#doc-info');
  await expect(info).toContainText('flattened');
  await info.click();
  await page.getByRole('menuitemradio', { name: 'Current Tool' }).click();
  await expect(info).toHaveText('Move');
  await expect(info).toHaveAttribute('aria-label', 'Current Tool: Move');
});

test('the bottom dock stays under the canvas when document windows float', async ({ page }) => {
  await page.getByRole('region', { name: 'New from a preset' }).getByRole('button', { name: /Large web page/ }).click();
  await expect.poll(() => page.evaluate(() => window.photoStudio.hasDocument)).toBe(true);
  await page.evaluate(async () => {
    const e = window.photoStudio;
    await e.runCommand('window.panel.timeline');
    await e.runCommand('window.new-window');
    await e.runCommand('window.float');
  });
  const frames = await page.locator('.view-frames').boundingBox();
  const dock = await page.locator('.bottom-dock').boundingBox();
  expect(frames && dock && dock.y >= frames.y + frames.height - 1).toBe(true);
});
