import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const kind of ['open', 'permissions'])
  for (const newerAction of ['typing', 'focus'])
    test(`a late ${kind} password rejection preserves newer ${newerAction}`, async ({ page }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /Open a PDF/ }).click();
      await (
        await chooser
      ).setFiles({
        name: 'locked.pdf',
        mimeType: 'application/pdf',
        buffer: await readFile(new URL('../fixtures/security/aes-256-r5.pdf', import.meta.url)),
      });
      let dialog = page.getByRole('dialog', { name: 'Password required', exact: true });
      if (kind === 'permissions') {
        await dialog.getByLabel('Password', { exact: true }).fill('user');
        await dialog.getByRole('button', { name: 'Open', exact: true }).click();
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
        await page.getByRole('button', { name: 'Protected', exact: true }).click();
        dialog = page.getByRole('dialog', { name: 'Permissions password required', exact: true });
      }
      await expect(dialog).toBeVisible();
      const input = dialog.getByLabel(kind === 'open' ? 'Password' : 'Permissions password', {
        exact: true,
      });
      const submit = dialog.getByRole('button', {
        name: kind === 'open' ? 'Open' : 'Unlock',
        exact: true,
      });
      await page.evaluate(() => {
        const digest = SubtleCrypto.prototype.digest;
        let first = true;
        SubtleCrypto.prototype.digest = async function (...args) {
          const result = await digest.apply(this, args);
          if (first) {
            first = false;
            await new Promise((resolve) => {
              window.releasePasswordCheck = resolve;
            });
          }
          return result;
        };
      });
      await input.fill('wrong');
      await input.press('Enter');
      await expect.poll(() => page.evaluate(() => !!window.releasePasswordCheck)).toBe(true);
      await expect(submit).toBeDisabled();
      const password = kind === 'open' ? 'user' : 'owner';
      await input.fill(password.slice(0, -1));
      await expect
        .poll(() => input.evaluate((node) => [node.selectionStart, node.selectionEnd]))
        .toEqual([password.length - 1, password.length - 1]);
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      if (newerAction === 'focus') await cancel.focus();
      await page.evaluate(() => window.releasePasswordCheck());
      await expect(submit).toBeEnabled();
      if (newerAction === 'focus') {
        await expect(cancel).toBeFocused();
        await expect(input).toHaveValue(password.slice(0, -1));
        await input.fill(password);
      } else {
        // A stale rejection must not select the replacement draft and overwrite it on typing.
        await page.keyboard.type(password.slice(-1));
      }
      await expect(input).toHaveValue(password);
      await expect(dialog.getByRole('alert')).toBeHidden();
      await input.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      if (kind === 'permissions') {
        await page.getByRole('button', { name: 'Protected', exact: true }).click();
        await expect(
          page.getByRole('dialog', { name: 'Change password', exact: true }),
        ).toBeVisible();
      }
    });
