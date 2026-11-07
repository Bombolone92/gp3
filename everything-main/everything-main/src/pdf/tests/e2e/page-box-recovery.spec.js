import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { pageBoxPdf } from '../fixtures/page-boxes.js';

async function open(page, bytes) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({ name: 'page-box.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function menu(page, name) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}
async function download(page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await downloading).path()));
}

for (const kind of ['nonnumeric coordinate', 'zero width', 'zero height'])
  for (const inherited of [false, true])
    test(`crop and remove crop work for ${kind} media boxes (inherited=${inherited})`, async ({
      page,
    }) => {
      await open(page, await pageBoxPdf(kind, false, 90, inherited));
      await menu(page, 'Crop pages…');
      await page.getByRole('button', { name: 'Margins…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Crop pages', exact: true });
      for (const side of ['Top', 'Bottom', 'Left', 'Right'])
        await dialog.getByLabel(`${side} (pt)`, { exact: true }).fill('18');
      await dialog.getByRole('button', { name: 'Crop', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      expect((await download(page)).getPage(0).getCropBox()).toEqual({
        x: 18,
        y: 18,
        width: 576,
        height: 756,
      });
      await menu(page, 'Remove crop');
      await expect(page.locator('#toast')).toHaveText('The full page is shown again.');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const restored = (await download(page)).getPage(0);
      expect(restored.getCropBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
      expect(restored.getRotation().angle).toBe(90);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      expect((await download(page)).getPage(0).getCropBox()).toEqual({
        x: 18,
        y: 18,
        width: 576,
        height: 756,
      });
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      expect((await download(page)).getPage(0).getCropBox()).toEqual({
        x: 0,
        y: 0,
        width: 612,
        height: 792,
      });
    });

for (const box of [
  [0, 0, 'invalid', 792],
  [900, 900, 1000, 1000],
])
  test(`removing ignored crop ${JSON.stringify(box)} leaves history unchanged`, async ({
    page,
  }) => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).node.set(PDFName.of('CropBox'), doc.context.obj(box));
    await open(page, await doc.save());
    await menu(page, 'Remove crop');
    await expect(page.locator('#toast')).toHaveText('This page is not cropped.');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(page.locator('.save-status')).toHaveText('Local file');
  });
