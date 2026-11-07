import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

for (const format of ['png', 'jpeg'])
  test(`replacing a ${format} batch stops reads beyond its pending first picture`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      window.pictureReads = [];
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        if (this.name.startsWith('earlier-')) {
          window.pictureReads.push(this.name);
          if (this.name.startsWith('earlier-1.'))
            await new Promise((resolve) => {
              window.finishFirstPicture = () => {
                resolve();
                setTimeout(() => {
                  window.firstPictureDone = true;
                }, 0);
              };
            });
        }
        return read.call(this);
      };
    });
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const canvas = createCanvas(4, 3);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d02020';
    ctx.fillRect(0, 0, 4, 3);
    const buffer = await canvas.encode(format);
    let chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await chooser
    ).setFiles(
      [1, 2, 3].map((i) => ({
        name: `earlier-${i}.${format}`,
        mimeType: `image/${format}`,
        buffer,
      })),
    );
    await expect.poll(() => page.evaluate(() => typeof window.finishFirstPicture)).toBe('function');
    const latest = await PDFDocument.create();
    latest.addPage([350, 450]);
    latest.addPage([350, 450]);
    chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await chooser
    ).setFiles({
      name: 'latest.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await latest.save()),
    });
    await expect(page).toHaveTitle('latest.pdf · PDF Editor');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => window.finishFirstPicture());
    await expect.poll(() => page.evaluate(() => window.firstPictureDone)).toBe(true);
    expect(await page.evaluate(() => window.pictureReads)).toEqual([`earlier-1.${format}`]);
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    await expect(page.locator('#toast')).toBeHidden();
    expect(errors).toEqual([]);
  });

test('an oversized encoded picture batch stops early and preserves the open PDF', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://js.puter.com/**', (route) => route.abort());
  await page.addInitScript(() => {
    window.pictureReads = [];
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name.startsWith('oversized-')) window.pictureReads.push(this.name);
      return read.call(this);
    };
  });
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  const title = await page.title();
  const canvas = createCanvas(4, 3);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d02020';
  context.fillRect(0, 0, 4, 3);
  const jpeg = Array.from(await canvas.encode('jpeg'));
  await page.evaluate(async (jpeg) => {
    const { jpegMetadata } = await import('/tests/fixtures/image-metadata.js');
    const { blankPdf, validatePdf } = await import('/src/core/document.js');
    const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
    const save = prototype.save;
    window.pictureSaves = 0;
    prototype.save = function (...args) {
      window.pictureSaves++;
      return save.apply(this, args);
    };
    // Shared source Blob keeps the fixture small. Each native File read still creates
    // a distinct image payload, just as a real selected batch does.
    const blob = new Blob([jpegMetadata(new Uint8Array(jpeg), 14 * 1024 * 1024)]);
    const transfer = new DataTransfer();
    for (let i = 1; i <= 12; i++)
      transfer.items.add(new File([blob], `oversized-${i}.jpg`, { type: 'image/jpeg' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  }, jpeg);
  await expect(page.locator('#toast')).toContainText(
    'These pictures would exceed the 100 MB PDF limit. Choose fewer pictures.',
  );
  expect(await page.evaluate(() => window.pictureReads.length)).toBe(8);
  expect(await page.evaluate(() => window.pictureSaves)).toBe(0);
  await expect(page).toHaveTitle(title);
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
