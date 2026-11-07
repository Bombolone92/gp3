import { test, expect } from '@playwright/test';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';

for (const [shape, width, height, rotation] of [
  ['landscape', 600, 400, 0],
  ['rotated', 400, 600, 90],
  ['tall', 40, 400, 0],
  ['short', 400, 40, 0],
])
  test(`the ${shape} thumbnail shows the actual paper boundary without false white margins`, async ({
    page,
  }, testInfo) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const doc = await PDFDocument.create(),
      sheet = doc.addPage([width, height]);
    sheet.setRotation(degrees(rotation));
    sheet.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.2, 0.4, 0.6) });
    const choosing = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await choosing
    ).setFiles({
      name: 'shape.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    if (!(await page.locator('#page-sidebar').isVisible()))
      await page.getByRole('button', { name: 'Toggle pages panel', exact: true }).click();
    const thumbnail = page.getByRole('button', { name: 'Go to page 1', exact: true });
    const canvas = thumbnail.locator('canvas');
    await expect
      .poll(() =>
        canvas.evaluate((c) =>
          [
            ...c
              .getContext('2d')
              .getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data,
          ].slice(0, 3),
        ),
      )
      .toEqual([51, 102, 153]);
    const buttonBox = await thumbnail.boundingBox(),
      paperBox = await thumbnail.locator('.thumb-paper').boundingBox(),
      canvasBox = await canvas.boundingBox();
    const ratio = rotation ? height / width : width / height;
    const contentRatio = await canvas.evaluate((c) => {
      const rect = c.getBoundingClientRect(),
        css = getComputedStyle(c);
      return (
        (rect.width - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)) /
        (rect.height - parseFloat(css.borderTopWidth) - parseFloat(css.borderBottomWidth))
      );
    });
    expect(contentRatio).toBeCloseTo(ratio, 1);
    const image = await loadImage(
      await thumbnail.screenshot({ path: testInfo.outputPath('thumbnail.png'), scale: 'css' }),
    );
    const snapshot = createCanvas(image.width, image.height),
      ctx = snapshot.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixel = (x, y) => [
      ...ctx.getImageData(Math.floor(x - buttonBox.x), Math.floor(y - buttonBox.y), 1, 1).data,
    ];
    const reference = pixel(buttonBox.x + 3, paperBox.y + paperBox.height / 2);
    const gap =
      paperBox.width - canvasBox.width > 12
        ? pixel(paperBox.x + 3, canvasBox.y + canvasBox.height / 2)
        : pixel(canvasBox.x + canvasBox.width / 2, paperBox.y + 3);
    expect(gap).toEqual(reference);
  });
