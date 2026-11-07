import { test, expect } from '@playwright/test';

for (const width of [1200, 390])
  test.describe(`menu presses at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    for (const releaseOutside of [false, true])
      test(`a held closing press stays closed (release outside=${releaseOutside})`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        const opener =
          width === 1200
            ? page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true })
            : page.getByRole('button', { name: 'Menu', exact: true });
        await opener.click();
        await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeVisible();
        const box = await opener.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await expect(page.getByRole('menu')).toHaveCount(0);
        // Releasing the same press must stay closed even after a deliberate hold.
        await page.waitForTimeout(900);
        if (releaseOutside) await page.mouse.move(8, 750);
        await page.mouse.up();
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(opener).toHaveAttribute('aria-expanded', 'false');
        // A later keyboard or pointer activation is a new action, not that closing click.
        await opener.press('Enter');
        await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await opener.click();
        await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeVisible();
        await opener.click();
        await expect(page.getByRole('menu')).toHaveCount(0);
      });
  });

test.describe('menu panel keys', () => {
  test.use({ viewport: { width: 1200, height: 800 } });
  test('arrow keys from a menu panel itself start at its first or last item', async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const opener = page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true });
    const menu = page.getByRole('menu', { name: 'File', exact: true });
    const items = menu.locator('button:not([disabled])');
    for (const [key, index] of [
      ['ArrowUp', -1],
      ['ArrowDown', 0],
    ]) {
      await opener.click();
      // A click on a separator leaves focus on the panel rather than on an item.
      await menu.getByRole('separator').first().click();
      await expect(menu).toBeFocused();
      await page.keyboard.press(key);
      await expect(index < 0 ? items.last() : items.first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
  });
});

test.describe('menus under dialogs', () => {
  test.use({ viewport: { width: 1200, height: 800 } });
  test('a dialog that opens over an open menu closes it and owns its keys', async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const opener = page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true });
    await opener.click();
    await expect(page.getByRole('menu', { name: 'View', exact: true })).toBeVisible();
    // A dialog can open while a menu is up, for example when one chosen earlier opens it
    // after pending work finishes.
    await page.evaluate(async () => {
      const { modal, el } = await import('/src/lib/ui.js');
      modal('Late dialog', el('textarea', { 'aria-label': 'Notes' }));
    });
    const dialog = page.getByRole('dialog', { name: 'Late dialog' });
    const notes = dialog.getByRole('textbox', { name: 'Notes' });
    await expect(notes).toBeFocused();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await notes.fill('one\ntwo');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => notes.evaluate((area) => area.selectionStart)).toBeLessThanOrEqual(3);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
