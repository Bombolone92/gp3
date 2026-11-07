import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { inspectPaths } from '../../src/core/path-edit.js';

async function openDrawing(page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'drawing.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const box = await page.locator('.drawing-overlay').boundingBox();
  return (x, y) => ({
    x: box.x + (x * box.width) / 400,
    y: box.y + ((400 - y) * box.height) / 400,
  });
}

for (const moved of [false, true])
  test(`freehand drawing retains the release point ${moved ? 'after' : 'without'} a move event`, async ({
    page,
  }) => {
    const at = await openDrawing(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...at(80, 280),
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    if (moved)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...at(140, 250),
        button: 'left',
        buttons: 1,
      });
    // The release can carry a newer sample than the last dispatched pointermove.
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...at(200, 220),
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const doc = await PDFDocument.load(await readFile(await (await download).path()));
    const paths = inspectPaths(doc, 0);
    expect(paths).toHaveLength(1);
    const coordinates = paths[0].svg.match(/-?\d+(?:\.\d+)?/g).map(Number);
    expect(coordinates.at(-2)).toBeCloseTo(200, 0);
    expect(coordinates.at(-1)).toBeCloseTo(220, 0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

test('a stationary drawing tap and a cancelled stroke create no history', async ({ page }) => {
  const at = await openDrawing(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...at(80, 280),
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...at(80, 280),
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...at(80, 280),
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...at(140, 250),
    button: 'left',
    buttons: 1,
  });
  await page.keyboard.press('Escape');
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...at(200, 220),
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

for (const tool of ['Draw', 'Shape', 'Highlight', 'Crop', 'Link'])
  test(`${tool} abandons lost pointer capture and accepts the next gesture`, async ({ page }) => {
    await openDrawing(page);
    if (tool === 'Crop' || tool === 'Link') {
      if (!(await page.getByRole('menubar', { name: 'PDF menus' }).isVisible()))
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page
        .getByRole('menuitem', { name: tool === 'Crop' ? 'Page' : 'Insert', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: tool === 'Crop' ? 'Crop pages…' : 'Link…', exact: true })
        .click();
    } else if (tool !== 'Draw') {
      await page.getByRole('button', { name: tool, exact: true }).click();
      if (tool === 'Highlight') await page.getByLabel('Highlight mode').selectOption('area');
    }
    const overlay = page.locator('.drawing-overlay');
    await expect(overlay).toHaveClass(/active/);
    const box = await overlay.boundingBox();
    const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
    const end = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 };
    const painted = () =>
      overlay.evaluate((canvas) =>
        canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((v, i) => i % 4 === 3 && v !== 0),
      );
    await overlay.evaluate((node) =>
      node.addEventListener(
        'pointerdown',
        (e) => {
          node.dataset.pointerId = e.pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    expect(await painted()).toBe(true);
    // A different pointer losing capture must not cancel this pointer's preview.
    await overlay.dispatchEvent('lostpointercapture', { pointerId: 999 });
    expect(await painted()).toBe(true);
    // Releasing the browser's actual capture reproduces interruption without a pointerup.
    await overlay.evaluate((node) => node.releasePointerCapture(Number(node.dataset.pointerId)));
    await page.mouse.move(end.x + 1, end.y);
    await expect.poll(painted).toBe(false);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    expect(await painted()).toBe(true);
    await page.mouse.up();
    if (tool === 'Link') await expect(page.getByRole('dialog')).toBeVisible();
    else if (tool === 'Crop')
      await expect(page.getByRole('group', { name: 'Crop area' })).toBeVisible();
    else {
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
    }
  });

for (const zoom of ['0.75', '1.5'])
  test(`shape constraints update immediately when Shift changes at ${zoom} zoom`, async ({
    page,
  }) => {
    await openDrawing(page);
    await page.getByLabel('Zoom', { exact: true }).selectOption(zoom);
    await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Shape', exact: true }).click();
    const overlay = page.locator('.drawing-overlay');
    const box = await overlay.boundingBox();
    const view = await page.locator('.workspace').boundingBox();
    const start = { x: Math.max(box.x, view.x) + 35, y: Math.max(box.y, view.y) + 35 };
    const end = { x: start.x + 100, y: start.y + 50 };
    const pixels = () => overlay.evaluate((canvas) => canvas.toDataURL());
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    const rectangle = await pixels();
    await page.keyboard.down('Shift');
    await expect.poll(async () => (await pixels()) === rectangle).toBe(false);
    const square = await pixels();
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await pixels()) === rectangle).toBe(true);
    await page.keyboard.down('Shift');
    await expect.poll(async () => (await pixels()) === square).toBe(true);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const doc = await PDFDocument.load(await readFile(await (await download).path()));
    const [path] = inspectPaths(doc, 0);
    expect(path.bounds[2] - path.bounds[0]).toBeCloseTo(path.bounds[3] - path.bounds[1], 3);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

test('a shape preview keeps its endpoint under a stationary pointer while scrolling', async ({
  page,
}) => {
  await openDrawing(page);
  await page.getByLabel('Zoom', { exact: true }).selectOption('2');
  await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  const workspace = page.locator('.workspace');
  const view = await workspace.boundingBox();
  const overlay = page.locator('.drawing-overlay');
  const start = { x: view.x + 60, y: view.y + 60 };
  const end = { x: start.x + 80, y: start.y + 80 };
  const bottom = () =>
    overlay.evaluate((canvas) => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      for (let i = data.length - 1; i >= 0; i -= 4) {
        if (data[i]) {
          const rect = canvas.getBoundingClientRect();
          return rect.top + ((Math.floor(i / 4 / canvas.width) + 1) * rect.height) / canvas.height;
        }
      }
      return null;
    });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 3 });
  const before = await bottom();
  expect(before).not.toBeNull();
  const scroll = await workspace.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 40);
  await expect.poll(() => workspace.evaluate((node) => node.scrollTop)).not.toBe(scroll);
  await expect.poll(bottom).toBeCloseTo(before, 0);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});
