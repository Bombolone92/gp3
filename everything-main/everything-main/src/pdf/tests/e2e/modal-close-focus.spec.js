import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function holdClose(page) {
  // close() hides the dialog and returns focus before dispatching its queued event.
  await page.evaluate(() =>
    window.addEventListener(
      'close',
      (event) => {
        event.stopImmediatePropagation();
        window.releaseModalClose = () => event.target.dispatchEvent(new Event('close'));
      },
      { capture: true, once: true },
    ),
  );
}
async function trackFocus(control) {
  await control.focus();
  await control.evaluate((node) =>
    node.addEventListener('blur', () => {
      window.newerModalFocusLost = true;
    }),
  );
}
for (const dismiss of ['Escape', 'button'])
  for (const moved of [false, true])
    test(`Settings ${dismiss} ${moved ? 'preserves newer focus' : 'restores its opener'}`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.abort());
      await page.goto('/#library');
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      await settings.focus();
      await settings.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(dialog).toBeVisible();
      await holdClose(page);
      if (dismiss === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!window.releaseModalClose)).toBe(true);
      const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
      if (moved) await trackFocus(shortcuts);
      await page.evaluate(() => window.releaseModalClose());
      await expect(
        page.getByRole('dialog', { name: 'Settings', exact: true, includeHidden: true }),
      ).toHaveCount(0);
      await expect(moved ? shortcuts : settings).toBeFocused();
      if (moved) expect(await page.evaluate(() => !!window.newerModalFocusLost)).toBe(false);
      // A late close handler must not make the next Enter activate the old opener.
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('dialog', { name: moved ? 'Keyboard shortcuts' : 'Settings', exact: true }),
      ).toBeVisible();
    });
for (const accept of [false, true])
  for (const moved of [false, true])
    test(`${accept ? 'accepting' : 'cancelling'} a rename ${moved ? 'preserves newer focus' : 'restores its opener'}`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.abort());
      const doc = await PDFDocument.create();
      doc.addPage([400, 500]);
      await page.goto('/#library');
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /^Open a PDF/ }).click();
      await (
        await chooser
      ).setFiles({
        name: 'Original.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      const opener = page.locator('.document-name');
      await opener.focus();
      await opener.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Name this PDF', exact: true });
      const input = dialog.getByLabel('File name', { exact: true });
      await input.fill('Updated');
      await holdClose(page);
      if (accept) await input.press('Enter');
      else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!window.releaseModalClose)).toBe(true);
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (moved) await trackFocus(settings);
      await page.evaluate(() => window.releaseModalClose());
      await expect(
        page.getByRole('dialog', { name: 'Name this PDF', exact: true, includeHidden: true }),
      ).toHaveCount(0);
      await expect(opener).toHaveAccessibleName(`Rename ${accept ? 'Updated' : 'Original'}.pdf`);
      await expect(moved ? settings : opener).toBeFocused();
      if (moved) expect(await page.evaluate(() => !!window.newerModalFocusLost)).toBe(false);
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await page.keyboard.press('Enter');
      const reopened = page.getByRole('dialog', {
        name: moved ? 'Settings' : 'Name this PDF',
        exact: true,
      });
      await expect(reopened).toBeVisible();
      if (!moved)
        await expect(reopened.getByLabel('File name', { exact: true })).toHaveValue(
          accept ? 'Updated' : 'Original',
        );
      await reopened.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      expect((await download).suggestedFilename()).toBe(`${accept ? 'Updated' : 'Original'}.pdf`);
    });
