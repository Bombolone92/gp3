import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function menu(page, name) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function openPdf(page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 300]).drawText('A page to download', { x: 30, y: 200, size: 20, font });
  const bytes = await doc.save();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'picture.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  return Array.from(bytes);
}

/** Pause a real PDF.js output render at its continuation, so a slow page is reproducible. */
async function holdImageRender(page, bytes) {
  await page.evaluate(async (bytes) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => /\/pdfjs-dist\.js(?:\?|$)/.test(url));
    if (!moduleUrl) throw new Error('The loaded PDF.js module was not found.');
    const pdfjs = await import(moduleUrl);
    const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
    const pdf = await loading.promise;
    const prototype = Object.getPrototypeOf(await pdf.getPage(1));
    const render = prototype.render;
    prototype.render = function (options) {
      const task = render.call(this, options);
      if (window.holdImageRender && options.viewport.scale === 2) {
        window.holdImageRender = false;
        task.onContinue = (resume) => {
          task.onContinue = null;
          window.resumeImageRender = resume;
        };
        task.promise.then(
          () => {
            window.imageRenderOutcome = 'rendered';
          },
          (error) => {
            window.imageRenderOutcome = error.name;
          },
        );
      }
      return task;
    };
    await loading.destroy();
    window.holdImageRender = true;
  }, bytes);
}

test('an undo shortcut cannot destroy a single-page image download in progress', async ({
  page,
}) => {
  const bytes = await openPdf(page);
  await menu(page, 'Rotate clockwise');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await holdImageRender(page, bytes);
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await menu(page, 'Download page as image');
  await expect.poll(() => page.evaluate(() => Boolean(window.resumeImageRender))).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await page.evaluate(() => {
    window.resumeImageRender();
  });
  await expect.poll(() => page.evaluate(() => window.imageRenderOutcome)).toBe('rendered');
  await expect.poll(() => downloads.length).toBe(1);
  expect(downloads[0].suggestedFilename()).toBe('picture page 1.png');
  const png = await readFile(await downloads[0].path());
  expect(png.readUInt32BE(16)).toBe(600);
  expect(png.readUInt32BE(20)).toBe(800);
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#toast')).toHaveText('Page 1 downloaded as a PNG picture.');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('a single-page image render can be cancelled and retried without losing editor state', async ({
  page,
}) => {
  const bytes = await openPdf(page);
  await holdImageRender(page, bytes);
  const downloads = [],
    errors = [];
  page.on('download', (download) => downloads.push(download));
  page.on('pageerror', (error) => errors.push(error.message));
  await menu(page, 'Download page as image');
  await expect.poll(() => page.evaluate(() => Boolean(window.resumeImageRender))).toBe(true);
  const progress = page.getByRole('dialog', { name: 'Downloading pages as images', exact: true });
  await expect(progress).toBeVisible();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(progress).toHaveCount(0);
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(() => page.evaluate(() => window.imageRenderOutcome))
    .toBe('RenderingCancelledException');
  await expect(page.locator('#toast')).toBeHidden();
  expect(downloads).toEqual([]);
  await menu(page, 'Download page as image');
  await expect.poll(() => downloads.length).toBe(1);
  const png = await readFile(await downloads[0].path());
  expect(png.readUInt32BE(16)).toBe(800);
  expect(png.readUInt32BE(20)).toBe(600);
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeEnabled();
  await expect(page.locator('.save-status')).toHaveText('Local file');
  expect(errors).toEqual([]);
});
