import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

async function redPaint(bytes) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  let left = canvas.width,
    top = canvas.height,
    right = -1,
    bottom = -1;
  for (let i = 0; i < data.length; i += 4) {
    // Include thin red edges antialiased against either white paper or a black fill.
    const amount = Math.max(0, data[i] - (data[i + 1] + data[i + 2]) / 2) / 255;
    ink += amount;
    // Ignore the nearly gray page edge that can enter a rounded input's screenshot.
    if (amount > 4 / 255) {
      const x = (i / 4) % canvas.width,
        y = Math.floor(i / 4 / canvas.width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { ink, width: right - left + 1, height: bottom - top + 1 };
}

for (const name of [StandardFonts.Helvetica, StandardFonts.TimesRoman, StandardFonts.Courier]) {
  test(`editing ${name} retains PDF glyph spacing`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(name);
    doc.addPage([600, 400]).drawText('AVATAR To WA ffi', {
      x: 30,
      y: 300,
      size: 32,
      font,
      color: rgb(1, 0, 0),
    });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'spacing.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Edit text: AVATAR To WA ffi', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Edit text', exact: true });
    await expect(page.locator('.text-draft-background')).toBeVisible();
    await page.getByLabel('Text X in points', { exact: true }).focus();
    await page.mouse.move(0, 0);
    const source = await page
      .locator('.paper > canvas')
      .first()
      .evaluate((el) => el.toDataURL());
    const sourcePaint = await redPaint(Buffer.from(source.split(',')[1], 'base64'));
    const draftPaint = await redPaint(
      await input.screenshot({
        style:
          '.text-edit-handles { visibility: hidden; } .page-text-input { outline: none !important; }',
      }),
    );
    expect(Math.abs(draftPaint.width - sourcePaint.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(draftPaint.height - sourcePaint.height)).toBeLessThanOrEqual(2);
  });
}

for (const mode of [1, 2]) {
  for (const { rotation, transformKind } of [
    { rotation: 0, transformKind: 'none' },
    { rotation: 90, transformKind: 'none' },
    ...(mode === 1
      ? [
          { rotation: 0, transformKind: 'text' },
          { rotation: 0, transformKind: 'graphics' },
        ]
      : []),
  ]) {
    for (const lineWidth of [1.5, 0]) {
      test(`text paint mode ${mode}, width ${lineWidth}, ${transformKind} transform preserves its preview and edits on rotated page ${rotation}`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pdfPage = doc.addPage([400, 400]);
        const unit = rotation ? 2 : 1;
        const skew = transformKind !== 'none';
        const yScale = skew ? Math.hypot(0.2, 1.2) : 1;
        const matrixScale = transformKind === 'text' ? Math.hypot(1.3, 0.25) : 1;
        const graphics = transformKind === 'graphics' ? '1.3 0.25 0.2 1.2 0 0 cm' : '';
        const position =
          transformKind === 'text' ? '1.3 0.25 0.2 1.2 40 260 Tm' : `40 ${skew ? 220 : 300} Td`;
        pdfPage.setRotation(degrees(rotation));
        pdfPage.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
        pdfPage.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F: font.ref } }));
        pdfPage.node.set(
          PDFName.of('Contents'),
          doc.context.register(
            doc.context.flateStream(
              `1 0 0 RG 0 0 0 rg ${lineWidth} w ${graphics} BT /F 36 Tf ${mode} Tr ${position} (Outline text) Tj ET`,
            ),
          ),
        );
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /Open a PDF/ }).click();
        await (
          await chooser
        ).setFiles({
          name: 'outlined.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        await page.getByRole('button', { name: 'Text', exact: true }).click();
        const target = page.locator('.text-target');
        await target.click();
        const input = page.getByRole('textbox', { name: 'Edit text', exact: true });
        const color = page.getByLabel('Annotation color', { exact: true });
        await expect(color).toHaveValue(mode === 1 ? '#ff0000' : '#000000');
        await expect(input).toHaveCSS(
          '-webkit-text-fill-color',
          mode === 1 ? 'rgba(0, 0, 0, 0)' : 'rgb(0, 0, 0)',
        );
        await expect(input).toHaveCSS('-webkit-text-stroke-color', 'rgb(255, 0, 0)');
        const stroke = lineWidth
          ? (lineWidth * (await page.locator('.paper').boundingBox()).width * yScale) /
            (400 * matrixScale)
          : (skew ? (yScale * Math.hypot(1.3, 0.2)) / (1.3 * 1.2 - 0.25 * 0.2) : 1) /
            (await page.evaluate(() => devicePixelRatio));
        const strokeWidth = () =>
          input.evaluate((el) => parseFloat(getComputedStyle(el).webkitTextStrokeWidth));
        expect(await strokeWidth()).toBeCloseTo(stroke, 3);
        await expect(page.locator('.text-draft-background')).toBeVisible();
        await input.press('ArrowRight');
        await page.getByLabel('Text X in points', { exact: true }).focus();
        // The transparent draft can expose a source target's hover decoration.
        await page.mouse.move(0, 0);
        await expect(page.locator('.text-target:hover')).toHaveCount(0);
        const source = await page
          .locator('.paper > canvas')
          .first()
          .evaluate((el) => el.toDataURL());
        const sourcePaint = await redPaint(Buffer.from(source.split(',')[1], 'base64'));
        const draftPaint = await redPaint(
          await input.screenshot({
            style:
              '.text-edit-handles { visibility: hidden; } .page-text-input { outline: none !important; }',
          }),
        );
        expect(sourcePaint.ink).toBeGreaterThan(0);
        expect(Math.abs(draftPaint.width - sourcePaint.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(draftPaint.height - sourcePaint.height)).toBeLessThanOrEqual(2);
        // Linux WebKit rasterizes a rotated canvas strokeText hairline more faintly than
        // the same one-device-pixel CSS stroke: ink coverage differs by about 16%, while
        // the glyph bounds agree. Keep the exact CSS-width check above and compare both
        // geometry and coverage here, allowing that rasterization difference for hairlines.
        const tolerance = lineWidth ? 0.15 : 0.2;
        expect(draftPaint.ink / sourcePaint.ink).toBeGreaterThan(1 - tolerance);
        expect(draftPaint.ink / sourcePaint.ink).toBeLessThan(1 + tolerance);
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeDisabled();
        await input.press('ControlOrMeta+Enter');
        await expect(input).toHaveCount(0);
        await expect(undo).toBeDisabled();
        await target.click();
        await page.getByLabel('Text size', { exact: true }).selectOption('48');
        // PDF line width is independent of the font size.
        expect(await strokeWidth()).toBeCloseTo(stroke, 3);
        await color.fill('#0000ff');
        await expect(input).toHaveCSS('-webkit-text-stroke-color', 'rgb(0, 0, 255)');
        await expect(input).toHaveCSS(
          '-webkit-text-fill-color',
          mode === 1 ? 'rgba(0, 0, 0, 0)' : 'rgb(0, 0, 255)',
        );
        await page.getByRole('button', { name: 'Move text', exact: true }).press('ArrowRight');
        expect(await strokeWidth()).toBeCloseTo(stroke, 3);
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const bytes = new Uint8Array(await readFile(await (await downloaded).path()));
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const { inspectText } = await import('../../src/core/text-edit.js');
        const task = pdfjs.getDocument({
          data: bytes.slice(),
          standardFontDataUrl: new URL(
            '../../node_modules/pdfjs-dist/standard_fonts/',
            import.meta.url,
          ).pathname,
        });
        try {
          const runs = await inspectText(
            await PDFDocument.load(bytes),
            0,
            await (await task.promise).getPage(1),
            pdfjs.OPS,
          );
          const run = runs.find((run) => run.text === 'Outline text');
          expect(run.state.mode).toBe(mode);
          expect(run.state.size).toBeCloseTo(48 / (unit * yScale), 6);
          expect(run.strokeColor).toBe('#0000ff');
          expect(run.strokeWidth).toBe(lineWidth);
        } finally {
          await task.destroy();
        }
        await undo.click();
        await target.click();
        await expect(color).toHaveValue(mode === 1 ? '#ff0000' : '#000000');
        await expect(input).toHaveCSS('-webkit-text-stroke-color', 'rgb(255, 0, 0)');
      });
    }
  }
}
