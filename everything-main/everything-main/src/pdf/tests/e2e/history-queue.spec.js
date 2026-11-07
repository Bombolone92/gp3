import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { clickAway } from './editing-helpers.js';

async function openPdf(page, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Open a PDF/ }).click();
  await (await chooser).setFiles({ name: 'history.pdf', mimeType: 'application/pdf', buffer });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
}

async function editedDocument(page) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.puter = {
        env: 'web',
        auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test-user' }) },
        fs: {
          readdir: async () => [],
          write: async (path, blob) => {
            window.savedPdf = [...new Uint8Array(await blob.arrayBuffer())];
            return { path, name: 'history.pdf' };
          },
        },
        ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} },
      };`,
    }),
  );
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]).drawText('Original words', { x: 40, y: 350, size: 18 });
  await page.goto('/#library');
  await openPdf(page, Buffer.from(await doc.save()));
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  for (const [before, after] of [
    ['Original words', 'First change'],
    ['First change', 'Second change'],
  ]) {
    await page.getByRole('button', { name: `Edit text: ${before}`, exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit text', exact: true }).fill(after);
    await clickAway(page);
    await expect(
      page.getByRole('button', { name: `Edit text: ${after}`, exact: true }),
    ).toBeEnabled();
  }
  // Pause the next redraw at its worker boundary, independently of device speed.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.action === 'GetTextContent') {
        Worker.prototype.postMessage = post;
        window.releaseHistoryRender = () => post.call(this, message, ...rest);
      } else post.call(this, message, ...rest);
    };
  });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate(() => !!window.releaseHistoryRender)).toBe(true);
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
}

test('rapid Undo then Redo preserves both commands while the page redraws', async ({ page }) => {
  await editedDocument(page);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.evaluate(() => window.releaseHistoryRender());
  await expect(
    page.getByRole('button', { name: 'Edit text: Second change', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
});

for (const output of ['download', 'save']) {
  test(`${output} waits for queued history and reopens the requested revision`, async ({
    page,
  }) => {
    await editedDocument(page);
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    const downloaded = output === 'download' ? page.waitForEvent('download') : null;
    await page.keyboard.press(output === 'download' ? 'ControlOrMeta+Shift+s' : 'ControlOrMeta+s');
    await page.evaluate(() => window.releaseHistoryRender());
    await expect(
      page.getByRole('button', { name: 'Edit text: First change', exact: true }),
    ).toBeEnabled();
    let bytes;
    if (downloaded) bytes = await readFile(await (await downloaded).path());
    else {
      await expect.poll(() => page.evaluate(() => !!window.savedPdf)).toBe(true);
      bytes = Buffer.from(await page.evaluate(() => window.savedPdf));
    }
    await expect(page.locator('.save-status')).not.toHaveText('Unsaved changes');
    await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
    await openPdf(page, bytes);
    await expect(
      page.getByRole('button', { name: 'Edit text: First change', exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });
}
