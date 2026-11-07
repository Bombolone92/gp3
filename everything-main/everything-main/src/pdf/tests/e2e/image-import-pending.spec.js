import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const image = {
  name: 'pending.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
    'base64',
  ),
};

async function prepare(page) {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this);
      if (this.type !== 'image/png') return bytes;
      return new Promise((resolve, reject) => {
        window.pendingImage = {
          resolve: () => resolve(bytes),
          reject: () => reject(new Error('Image could not be read.')),
        };
      });
    };
  });
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.puter = {
      env: 'web',
      auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test-user' }) },
      fs: { readdir: async () => [], write: async (path, blob) => {
        window.savedPdf = [...new Uint8Array(await blob.arrayBuffer())];
        return { path, name: 'test.pdf' };
      } },
      ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} },
    };`,
    }),
  );
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  doc.addPage([500, 400]);
  await page.goto('/#library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
}

async function insert(page, kind) {
  await page.evaluate(() => delete window.pendingImage);
  const chooser = page.waitForEvent('filechooser');
  if (kind === 'image') await page.getByRole('button', { name: 'Image', exact: true }).click();
  else {
    const bar = page.getByRole('menubar', { name: 'PDF menus' });
    if (await bar.isVisible())
      await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
    }
    await page.getByRole('menuitem', { name: 'Insert pictures as pages…', exact: true }).click();
  }
  await (await chooser).setFiles(image);
  await expect.poll(() => page.evaluate(() => !!window.pendingImage)).toBe(true);
}

function imageCount(doc, index) {
  const objects = doc.getPage(index).node.Resources()?.lookup(PDFName.of('XObject'));
  return (
    objects
      ?.entries()
      .filter(
        ([, ref]) =>
          doc.context.lookup(ref).dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
      ).length || 0
  );
}

for (const kind of ['image', 'pages']) {
  test(`leaving during a pending ${kind} import requires the unsaved-work choice`, async ({
    page,
  }) => {
    await prepare(page);
    await insert(page, kind);
    await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave this PDF?', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.pendingImage.resolve());
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
    await expect(page.locator('.page-caption')).toHaveText(
      kind === 'image' ? 'Page 1 of 2' : 'Page 2 of 3',
    );
  });

  for (const output of ['download', 'save']) {
    test(`${output} waits for a pending ${kind} import and includes it on the intended page`, async ({
      page,
    }) => {
      await prepare(page);
      await insert(page, kind);
      const pending = output === 'download' ? page.waitForEvent('download') : null;
      await page.keyboard.press(
        output === 'download' ? 'ControlOrMeta+Shift+s' : 'ControlOrMeta+s',
      );
      await page.evaluate(() => window.pendingImage.resolve());
      let bytes;
      if (pending) bytes = await readFile(await (await pending).path());
      else {
        await expect.poll(() => page.evaluate(() => !!window.savedPdf)).toBe(true);
        bytes = Buffer.from(await page.evaluate(() => window.savedPdf));
      }
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(kind === 'image' ? 2 : 3);
      expect(imageCount(doc, kind === 'image' ? 0 : 1)).toBe(1);
      expect(imageCount(doc, doc.getPageCount() - 1)).toBe(0);
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.page-caption')).toContainText('of 2');
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.locator('.page-caption')).toContainText(kind === 'image' ? 'of 2' : 'of 3');
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    });
  }

  test(`a failed ${kind} read leaves the document usable without a history entry`, async ({
    page,
  }) => {
    await prepare(page);
    await insert(page, kind);
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    await page.evaluate(() => window.pendingImage.reject());
    await expect(page.locator('#toast')).toHaveText('Image could not be read.');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(page.locator('.save-status')).toHaveText('Local file');
    await insert(page, kind);
    await page.evaluate(() => window.pendingImage.resolve());
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  });
}
