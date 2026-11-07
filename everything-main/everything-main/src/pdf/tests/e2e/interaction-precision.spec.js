import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, degrees, rgb } from 'pdf-lib';

async function openObjects(page, { rotation = 0, userUnit = 1 } = {}) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([500, 600]);
  sheet.setRotation(degrees(rotation));
  sheet.node.set(PDFName.of('UserUnit'), doc.context.obj(userUnit));
  sheet.drawText('Precise editing', { x: 60, y: 510, size: 18 });
  sheet.drawText('Another object', { x: 280, y: 510, size: 16 });
  sheet.drawRectangle({ x: 80, y: 320, width: 120, height: 80, color: rgb(0.7, 0.2, 0.2) });
  const png = await doc.embedPng(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  sheet.drawImage(png, { x: 280, y: 320, width: 80, height: 60 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'precision.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}

const center = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const handle = (page, kind, corner) =>
  page.getByRole('button', { name: `Resize ${kind}, corner ${corner}`, exact: true });
const ready = async (page) => {
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
};

for (const kind of ['shape', 'image'])
  for (const rotation of [0, 90])
    test(`${kind} off-center resize tracks the pointer at ${rotation} degrees through zoom and history`, async ({
      page,
    }) => {
      await openObjects(page, { rotation, userUnit: rotation ? 2 : 1 });
      for (const zoom of ['0.5', '1.25']) {
        await page.getByLabel('Zoom', { exact: true }).selectOption(zoom);
        await ready(page);
        if (
          (await page
            .getByRole('button', { name: `Select ${kind} 1`, exact: true })
            .getAttribute('aria-pressed')) !== 'true'
        )
          await page.getByRole('button', { name: `Select ${kind} 1`, exact: true }).click();
        await page.getByLabel(`Keep ${kind} proportions`, { exact: true }).uncheck();
        for (const corner of [1, 2, 3, 4]) {
          const knob = handle(page, kind, corner);
          await expect(knob).toBeEnabled();
          // Keep the whole drag inside the window: Firefox reports a synthetic pointer that
          // leaves it at a bogus position and never releases it.
          await knob.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
          await knob.hover();
          const before = await center(knob);
          const paperBefore = await page.locator('.paper').boundingBox();
          const opposite = handle(page, kind, ((corner + 1) % 4) + 1);
          const anchor = await center(opposite);
          const dx = Math.sign(before.x - anchor.x) * 16;
          const dy = Math.sign(before.y - anchor.y) * 12;
          const start = { x: before.x - 3, y: before.y + 3 };
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
          await page.mouse.up();
          await ready(page);
          const after = await center(knob);
          expect(after.x - before.x).toBeCloseTo(dx, 0);
          expect(after.y - before.y).toBeCloseTo(dy, 0);
          const fixed = await center(opposite);
          expect(fixed.x).toBeCloseTo(anchor.x, 0);
          expect(fixed.y).toBeCloseTo(anchor.y, 0);
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          await ready(page);
          if (
            (await page
              .getByRole('button', { name: `Select ${kind} 1`, exact: true })
              .getAttribute('aria-pressed')) !== 'true'
          )
            await page.getByRole('button', { name: `Select ${kind} 1`, exact: true }).click();
          expect(
            (await center(knob)).x - (await page.locator('.paper').boundingBox()).x,
          ).toBeCloseTo(before.x - paperBefore.x, 0);
          await page.getByRole('button', { name: 'Redo', exact: true }).click();
          await ready(page);
          if (
            (await page
              .getByRole('button', { name: `Select ${kind} 1`, exact: true })
              .getAttribute('aria-pressed')) !== 'true'
          )
            await page.getByRole('button', { name: `Select ${kind} 1`, exact: true }).click();
          expect(
            (await center(knob)).x - (await page.locator('.paper').boundingBox()).x,
          ).toBeCloseTo(after.x - paperBefore.x, 0);
        }
      }
    });

test('resize cursors follow the rendered corner diagonal after rotation', async ({ page }) => {
  await openObjects(page);
  await page.getByRole('button', { name: 'Select shape 1', exact: true }).click();
  await expect(handle(page, 'shape', 1)).toHaveCSS('cursor', 'nwse-resize');
  await expect(handle(page, 'shape', 2)).toHaveCSS('cursor', 'nesw-resize');
  await page.getByLabel('Shape rotation in degrees', { exact: true }).fill('45');
  await page.getByLabel('Shape rotation in degrees', { exact: true }).press('Tab');
  await ready(page);
  await expect(handle(page, 'shape', 1)).toHaveCSS('cursor', 'ns-resize');
  await expect(handle(page, 'shape', 2)).toHaveCSS('cursor', 'ew-resize');
});

for (const kind of ['shape', 'image'])
  for (const action of ['move', 'resize'])
    test(`${kind} ${action} stays under a stationary pointer while the page scrolls`, async ({
      page,
    }) => {
      await openObjects(page);
      await page.getByLabel('Zoom', { exact: true }).selectOption('2');
      await ready(page);
      await page.getByRole('button', { name: `Select ${kind} 1`, exact: true }).click();
      await page.getByLabel(`Keep ${kind} proportions`, { exact: true }).uncheck();
      const control =
        action === 'move'
          ? page.getByRole('button', { name: `Move selected ${kind}`, exact: true })
          : handle(page, kind, 3);
      // Wait for hit testing after scrolling before starting a raw pointer gesture.
      await control.hover();
      const before = await center(control);
      const workspace = page.locator('.workspace');
      const scroll = await workspace.evaluate((el) => el.scrollLeft);
      await page.mouse.move(before.x, before.y);
      await page.mouse.down();
      await page.mouse.wheel(scroll >= 40 ? -40 : 40, 0);
      await expect.poll(() => workspace.evaluate((el) => el.scrollLeft)).not.toBe(scroll);
      await expect.poll(async () => (await center(control)).x).toBeCloseTo(before.x, 0);
      await page.mouse.up();
      await ready(page);
      await expect.poll(async () => (await center(control)).x).toBeCloseTo(before.x, 0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
    });

for (const kind of ['text', 'image', 'shape'])
  for (const rotation of [0, 90])
    test(`${kind} drag then zoom preserves document positions through undo and redo at ${rotation} degrees`, async ({
      page,
    }) => {
      await openObjects(page, { rotation, userUnit: rotation ? 2 : 1 });
      await page.getByLabel('Zoom', { exact: true }).selectOption('0.5');
      await ready(page);
      const target = page.getByRole('button', {
        name: kind === 'text' ? 'Edit text: Precise editing' : `Select ${kind} 1`,
        exact: true,
      });
      await target.click();
      const move = page.getByRole('button', {
        name: kind === 'text' ? 'Move text' : `Move selected ${kind}`,
        exact: true,
      });
      await move.hover();
      const position = async () => {
        const bounds = await target.boundingBox();
        const paper = await page.locator('.paper').boundingBox();
        return (
          bounds && {
            x: (bounds.x - paper.x) / paper.width,
            y: (bounds.y - paper.y) / paper.height,
          }
        );
      };
      const before = await position();
      const paper = await page.locator('.paper').boundingBox();
      const start = await center(move);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 18, start.y + 12, { steps: 4 });
      await page.mouse.up();
      await expect
        .poll(async () => (await position())?.x)
        .toBeCloseTo(before.x + 18 / paper.width, 4);
      await expect
        .poll(async () => (await position())?.y)
        .toBeCloseTo(before.y + 12 / paper.height, 4);
      const moved = await position();
      await page.getByLabel('Zoom', { exact: true }).selectOption('1.5');
      await ready(page);
      await expect.poll(async () => (await position())?.x).toBeCloseTo(moved.x, 4);
      await expect.poll(async () => (await position())?.y).toBeCloseTo(moved.y, 4);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await ready(page);
      await expect.poll(async () => (await position())?.x).toBeCloseTo(before.x, 4);
      await expect.poll(async () => (await position())?.y).toBeCloseTo(before.y, 4);
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await ready(page);
      await expect.poll(async () => (await position())?.x).toBeCloseTo(moved.x, 4);
      await expect.poll(async () => (await position())?.y).toBeCloseTo(moved.y, 4);
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    });
