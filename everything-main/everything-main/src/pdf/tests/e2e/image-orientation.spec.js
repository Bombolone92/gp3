import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { inspectImages, imageCorners } from '../../src/core/image-edit.js';
import { jpegOrientation } from '../../src/core/image-pages.js';
import { pngExif } from '../fixtures/png-exif.js';
import { padJpegHeaders, jpegTem } from '../fixtures/jpeg-padding.js';

const COLORS = [
  [224, 0, 0],
  [0, 192, 0],
  [0, 0, 224],
  [224, 192, 0],
];
// Expected top-left, top-right, bottom-left, bottom-right colors after EXIF orientation.
const ORDER = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [3, 2, 1, 0],
  [2, 3, 0, 1],
  [0, 2, 1, 3],
  [2, 0, 3, 1],
  [3, 1, 2, 0],
  [1, 3, 0, 2],
];
function phonePhoto(orientation, format = 'jpeg') {
  const canvas = createCanvas(200, 100);
  const context = canvas.getContext('2d');
  COLORS.forEach((color, i) => {
    context.fillStyle = `rgb(${color.join(',')})`;
    context.fillRect((i % 2) * 100, Math.floor(i / 2) * 50, 100, 50);
  });
  if (format === 'png')
    return {
      name: 'oriented.png',
      mimeType: 'image/png',
      buffer: pngExif(canvas.toBuffer('image/png'), orientation),
    };
  const jpeg = canvas.toBuffer('image/jpeg');
  const exif = Buffer.from(
    'ffe1002245786966000049492a0008000000010012010300010000000600000000000000',
    'hex',
  );
  exif[28] = orientation;
  let buffer = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  if (format === 'padded jpeg' || format === 'TEM jpeg') buffer = padJpegHeaders(buffer);
  if (format === 'TEM jpeg') buffer = jpegTem(buffer, 2);
  return {
    name: 'phone-photo.jpg',
    mimeType: 'image/jpeg',
    buffer,
  };
}
async function chooseImage(page, button, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button, exact: true }).click();
  await (await chooser).setFiles(file);
}
async function exported(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}
function expectColors(colors, orientation) {
  colors.forEach((color, i) =>
    COLORS[ORDER[orientation - 1][i]].forEach((expected, channel) => {
      expect(Math.abs(color[channel] - expected)).toBeLessThan(12);
    }),
  );
}

for (const [format, decoder] of [
  ['jpeg', 'bitmap'],
  ['jpeg', 'image element'],
  ['padded jpeg', 'bitmap'],
  ['padded jpeg', 'image element'],
  ['TEM jpeg', 'bitmap'],
  ['TEM jpeg', 'image element'],
  ['png', 'bitmap'],
  ['png', 'image element'],
])
  for (const action of ['insert image', 'replace image', 'signature'])
    for (const orientation of action === 'insert image' && format !== 'TEM jpeg'
      ? [1, 2, 3, 4, 5, 6, 7, 8]
      : [2, 6])
      test(`${action} preserves ${format} photo orientation ${orientation} with the ${decoder} decoder`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        if (decoder === 'image element')
          await page.addInitScript(() => {
            window.createImageBitmap = undefined;
          });
        await page.goto('/');
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        if (action === 'insert image' && orientation === 6) {
          const doc = await PDFDocument.create();
          doc.addPage([400, 600]).setRotation(degrees(90));
          const chooser = page.waitForEvent('filechooser');
          await page.keyboard.press('ControlOrMeta+o');
          await (
            await chooser
          ).setFiles({
            name: 'turned.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(await doc.save()),
          });
          await expect(page).toHaveTitle('turned.pdf · PDF Editor');
          await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        }
        const photo = phonePhoto(orientation, format);
        const width = orientation >= 5 ? 100 : 200,
          height = orientation >= 5 ? 200 : 100;
        let previousTransform;
        if (action === 'signature') {
          await page.getByRole('button', { name: 'Sign', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Add signature' });
          await dialog.getByRole('tab', { name: 'Upload', exact: true }).click();
          await dialog.getByLabel('Signature image file').setInputFiles(photo);
          const preview = dialog.getByLabel('Uploaded signature preview');
          await expect(preview).toBeVisible();
          const colors = await preview.evaluate(
            (canvas, { width, height }) => {
              const context = canvas.getContext('2d');
              const ratio = canvas.width / canvas.clientWidth;
              const scale = Math.min(
                (canvas.width - 12 * ratio) / width,
                (canvas.height - 12 * ratio) / height,
              );
              return [0, 1, 2, 3].map((i) =>
                Array.from(
                  context.getImageData(
                    canvas.width / 2 + ((i % 2) / 2 - 0.25) * width * scale,
                    canvas.height / 2 + (Math.floor(i / 2) / 2 - 0.25) * height * scale,
                    1,
                    1,
                  ).data,
                ),
              );
            },
            { width, height },
          );
          expectColors(colors, orientation);
          await dialog.getByRole('button', { name: 'Place signature', exact: true }).click();
        } else if (action === 'replace image') {
          const original = createCanvas(200, 100);
          const context = original.getContext('2d');
          context.fillStyle = '#00a000';
          context.fillRect(0, 0, 200, 100);
          await chooseImage(page, 'Image', {
            name: 'original.png',
            mimeType: 'image/png',
            buffer: original.toBuffer('image/png'),
          });
          await expect(page.getByRole('group', { name: 'Edit image' })).toBeVisible();
          previousTransform = inspectImages(await exported(page), 0)[0].transform;
          const canvas = page.locator('.paper > canvas').first();
          const before = await canvas.evaluate((canvas) => canvas.toDataURL());
          await chooseImage(page, 'Replace image', photo);
          await expect.poll(() => canvas.evaluate((canvas) => canvas.toDataURL())).not.toBe(before);
        } else await chooseImage(page, 'Image', photo);
        await expect(page.getByRole('group', { name: 'Edit image' })).toBeVisible();
        const doc = await exported(page);
        const [image] = inspectImages(doc, 0);
        // Embedding retains the original pixel dimensions; orientation is applied in PDF space.
        expect(image.object.dict.get(PDFName.of('Width')).asNumber()).toBe(200);
        expect(image.object.dict.get(PDFName.of('Height')).asNumber()).toBe(100);
        if (format !== 'png') {
          // JPEGs retain their original encoding, with only the EXIF hint reset.
          const bytes = image.object.getContents();
          expect(jpegOrientation(bytes)).toBe(1);
          const unchangedPixels = Buffer.from(phonePhoto(orientation).buffer);
          unchangedPixels[30] = 1;
          expect(Buffer.from(bytes)).toEqual(unchangedPixels);
        }
        const pdfPage = doc.getPage(0),
          size = pdfPage.getSize(),
          rotation = pdfPage.getRotation().angle;
        const corners = imageCorners(image.transform).map(([x, y]) =>
          rotation === 90 ? [y, x] : [x, size.height - y],
        );
        const xs = corners.map(([x]) => x),
          ys = corners.map(([, y]) => y);
        const box = {
          left: Math.min(...xs),
          top: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
        expect(box.width / box.height).toBeCloseTo(width / height, 5);
        if (previousTransform) {
          expect(box.width).toBeLessThanOrEqual(previousTransform[0] + 1e-6);
          expect(box.height).toBeLessThanOrEqual(previousTransform[3] + 1e-6);
          expect(box.left + box.width / 2).toBeCloseTo(
            previousTransform[4] + previousTransform[0] / 2,
            6,
          );
          expect(size.height - box.top - box.height / 2).toBeCloseTo(
            previousTransform[5] + previousTransform[3] / 2,
            6,
          );
        }
        const colors = await page
          .locator('.paper > canvas')
          .first()
          .evaluate(
            (canvas, { box, size, rotation }) => {
              const context = canvas.getContext('2d');
              const sx = canvas.width / (rotation === 90 ? size.height : size.width);
              const sy = canvas.height / (rotation === 90 ? size.width : size.height);
              return [0, 1, 2, 3].map((i) =>
                Array.from(
                  context.getImageData(
                    (box.left + (0.25 + (i % 2) / 2) * box.width) * sx,
                    (box.top + (0.25 + Math.floor(i / 2) / 2) * box.height) * sy,
                    1,
                    1,
                  ).data,
                ),
              );
            },
            { box, size, rotation },
          );
        expectColors(colors, orientation);
      });

for (const [format, orientation] of [
  ['jpeg', 2],
  ['jpeg', 6],
  ['png', 2],
  ['png', 6],
])
  test(`${format} photo orientation ${orientation} stays intrinsic when editing and replacing its image`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/');
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    await chooseImage(page, 'Image', phonePhoto(orientation, format));
    await expect(page.getByRole('group', { name: 'Edit image' })).toBeVisible();
    const width = page.getByLabel('Image width in points', { exact: true });
    const height = page.getByLabel('Image height in points', { exact: true });
    expect(Number(await width.inputValue()) / Number(await height.inputValue())).toBeCloseTo(
      orientation === 6 ? 0.5 : 2,
      2,
    );
    await expect(page.getByLabel('Image rotation in degrees', { exact: true })).toHaveValue('0');
    const original = inspectImages(await exported(page), 0)[0];
    const move = page.getByRole('button', { name: 'Move selected image', exact: true });
    await move.scrollIntoViewIfNeeded();
    const handle = await move.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 15, handle.y + handle.height / 2 + 10);
    const preview = page.locator('.image-preview > canvas').nth(1);
    await expect(preview).toBeVisible();
    const previewColors = await preview.evaluate((canvas) => {
      const context = canvas.getContext('2d');
      return [0, 1, 2, 3].map((i) =>
        Array.from(
          context.getImageData(
            canvas.width * (0.25 + (i % 2) / 2),
            canvas.height * (0.25 + Math.floor(i / 2) / 2),
            1,
            1,
          ).data,
        ),
      );
    });
    expectColors(previewColors, orientation);
    await page.mouse.up();
    const moved = inspectImages(await exported(page), 0)[0];
    expect(moved.transform[4]).toBeGreaterThan(original.transform[4]);
    expect(moved.transform[5]).toBeLessThan(original.transform[5]);
    for (let i = 0; i < 4; i++) expect(moved.transform[i]).toBeCloseTo(original.transform[i], 6);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const restored = inspectImages(await exported(page), 0)[0];
    restored.transform.forEach((value, i) => expect(value).toBeCloseTo(original.transform[i], 6));
    await page.getByRole('button', { name: 'Select image 1', exact: true }).press('Enter');
    const before = await page
      .locator('.paper > canvas')
      .first()
      .evaluate((canvas) => canvas.toDataURL());
    await chooseImage(page, 'Replace image', phonePhoto(1));
    await expect
      .poll(() =>
        page
          .locator('.paper > canvas')
          .first()
          .evaluate((canvas) => canvas.toDataURL()),
      )
      .not.toBe(before);
    const [image] = inspectImages(await exported(page), 0);
    expect(image.transform[0]).toBeGreaterThan(0);
    expect(image.transform[3]).toBeGreaterThan(0);
    expect(image.transform[1]).toBeCloseTo(0, 6);
    expect(image.transform[2]).toBeCloseTo(0, 6);
  });
