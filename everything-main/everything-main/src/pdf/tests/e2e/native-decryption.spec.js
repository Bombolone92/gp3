import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function setup(page, hold = false, failure = false) {
  await page.route('https://js.puter.com/**', (route) => route.abort());
  await page.addInitScript(
    ({ hold, failure }) => {
      window.nativeDecryptions = 0;
      const prototype = Object.getPrototypeOf(crypto.subtle),
        decrypt = prototype.decrypt;
      prototype.decrypt = function (...args) {
        const result = decrypt.apply(this, args);
        if (args[2].byteLength < 64 * 1024) return result;
        window.nativeDecryptions++;
        if (!hold) return result;
        return result.then(async (bytes) => {
          await new Promise((resolve) => {
            window.releaseDecrypt = resolve;
          });
          setTimeout(() => {
            window.decryptFinished = true;
          }, 0);
          if (failure) throw new Error('Retired native decryption failed');
          return bytes;
        });
      };
    },
    { hold, failure },
  );
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function encryptedPdf(page, size) {
  await page.evaluate(async (size) => {
    const { blankPdf, validatePdf } = await import('/src/core/document.js');
    const { protectPdf } = await import('/src/core/security.js');
    const doc = await validatePdf(await blankPdf());
    const ref = doc.context.register(doc.context.stream(new Uint8Array(size)));
    const date = doc
      .getInfoDict()
      .entries()
      .find(([key]) => key.decodeText() === 'CreationDate')[1];
    for (const [key, value] of doc.context
      .obj({ PieceInfo: { PDFEditor: { LastModified: date, Private: ref } } })
      .entries())
      doc.getPage(0).node.set(key, value);
    const bytes = await protectPdf(await doc.save(), { open: 'reader', permissions: 'owner' });
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'private.pdf', { type: 'application/pdf' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  }, size);
  const dialog = page.getByRole('dialog', { name: 'Password required', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill('reader');
  return dialog;
}

test('opening an encrypted 80 MB stream keeps the event loop responsive', async ({ page }) => {
  test.setTimeout(60000);
  await setup(page);
  const dialog = await encryptedPdf(page, 80 * 1024 * 1024);
  await page.evaluate(() => {
    window.unlockGap = 0;
    window.unlockTick = performance.now();
    window.unlockTimer = setInterval(() => {
      const now = performance.now();
      window.unlockGap = Math.max(window.unlockGap, now - window.unlockTick);
      window.unlockTick = now;
    }, 10);
  });
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveTitle('private.pdf · PDF Editor');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  const observation = await page.evaluate(() => {
    clearInterval(window.unlockTimer);
    return {
      decryptions: window.nativeDecryptions,
      gap: Math.max(window.unlockGap, performance.now() - window.unlockTick),
    };
  });
  expect(observation.decryptions).toBeGreaterThan(1);
  expect(observation.gap).toBeLessThan(1000);
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeVisible();
});

for (const close of ['cancel', 'escape'])
  for (const failure of [false, true])
    test(`${close} during native decryption suppresses its late ${failure ? 'error' : 'success'}`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await setup(page, true, failure);
      const dialog = await encryptedPdf(page, 200000);
      await dialog.getByRole('button', { name: 'Open', exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.releaseDecrypt)).toBe('function');
      if (close === 'escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
      const latest = await PDFDocument.create();
      latest.addPage();
      latest.addPage();
      const pending = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await pending
      ).setFiles({
        name: 'latest.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await latest.save()),
      });
      await expect(page).toHaveTitle('latest.pdf · PDF Editor');
      await page.evaluate(() => window.releaseDecrypt());
      await expect.poll(() => page.evaluate(() => window.decryptFinished)).toBe(true);
      await expect(page).toHaveTitle('latest.pdf · PDF Editor');
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      await expect(page.getByRole('button', { name: 'Protected', exact: true })).toHaveCount(0);
      await expect(page.locator('#toast')).toBeHidden();
      expect(errors).toEqual([]);
    });
