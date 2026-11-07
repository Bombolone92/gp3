import { test, expect, type Page } from '@playwright/test';
import { boot, canvasClick, client, compositePixel, downloadFrom, historyLabels, idle, menu, openFiles, openProject, redo, run, tool, undo } from './helpers';
import { layer, newDocument } from '../../src/model/document';

async function start(page: Page, fallback = false) {
  await boot(page, fallback ? 'WebGL' : 'default');
}
async function fixture(page: Page) {
  const doc = newDocument(160, 120, 'Masks');
  const l = layer('solid', 'Photo', 160, 120);
  l.color = '#ff0000';
  doc.layers = [l];
  await openProject(page, doc, [], 'Masks.photo');
  await expect(page.locator('#layer-count')).toHaveText('1');
}
/** Alpha of the PNG written by File → Export → Quick Export as PNG. */
async function exportedAlpha(page: Page, x = 80, y = 60) {
  const { bytes } = await downloadFrom(page, () => run(page, 'file.quick-export-png'));
  return page.evaluate(
    async ({ bytes, x, y }) => {
      const b = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const c = new OffscreenCanvas(b.width, b.height).getContext('2d')!;
      c.drawImage(b, 0, 0);
      b.close();
      return c.getImageData(x, y, 1, 1).data[3];
    },
    { bytes: [...bytes], x, y },
  );
}
const alpha = async (page: Page, x = 80, y = 60) => (await compositePixel(page, x, y))[3];
async function paint(page: Page, x = 80, y = 60) {
  const before = (await historyLabels(page)).length;
  await canvasClick(page, x, y);
  await expect.poll(async () => (await historyLabels(page)).length).toBe(before + 1);
  await idle(page);
}
for (const fallback of [false, true])
  test(`mask UI, undo, persistence and pixels (${fallback ? 'WebGL' : 'default'})`, async ({
    page,
  }) => {
    await start(page, fallback);
    await fixture(page);
    // Masks are now pixel grids painted with the ordinary brush (black hides,
    // white reveals) instead of a dedicated mask brush with stroke lists.
    await menu(page, 'Layer', 'Layer Mask', 'Reveal All');
    await page.getByRole('button', { name: 'Edit mask for Photo' }).click();
    await expect(page.getByRole('button', { name: 'Edit mask for Photo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await tool(page, 'Brush Tool');
    await page.evaluate(() => window.photoStudio.setForeground('#000000'));
    // Escape cancels a stroke in progress without an undo step.
    const [cx, cy] = await client(page, 80, 60);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await idle(page);
    expect(await historyLabels(page)).toEqual(['Add Layer Mask']);
    expect(await alpha(page)).toBe(255);
    await paint(page);
    expect(await alpha(page)).toBe(0);
    expect(await exportedAlpha(page)).toBe(0);
    await undo(page);
    expect(await alpha(page)).toBe(255);
    await redo(page);
    expect(await alpha(page)).toBe(0);
    // White restores what black hid.
    await page.evaluate(() => window.photoStudio.setForeground('#ffffff'));
    await paint(page);
    expect(await alpha(page)).toBe(255);
    await undo(page);
    await menu(page, 'Layer', 'Layer Mask', 'Disable');
    expect(await alpha(page)).toBe(255);
    await menu(page, 'Layer', 'Layer Mask', 'Disable');
    expect(await alpha(page)).toBe(0);
    await menu(page, 'Layer', 'Layer Mask', 'Invert Mask');
    expect(await alpha(page)).toBe(255);
    expect(await alpha(page, 10, 10)).toBe(0);
    const { bytes } = await downloadFrom(page, () => menu(page, 'File', 'Download Project (.photo)'));
    await openFiles(page, { name: 'Masks reopened.photo', mimeType: 'application/octet-stream', buffer: bytes });
    expect(await page.evaluate(() => window.photoStudio.sessions.length)).toBe(2);
    expect(await alpha(page, 10, 10)).toBe(0);
    expect(await alpha(page)).toBe(255);
    await menu(page, 'Layer', 'Layer Mask', 'Delete');
    expect(await alpha(page, 10, 10)).toBe(255);
    expect(await exportedAlpha(page, 10, 10)).toBe(255);
  });

test('worker masks preserve soft edges, bitmap alpha, rectangular bases and selection clipping', async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const { ImageEngine } = await import('/src/engine/engine.ts');
    const { layer } = await import('/src/model/document.ts');
    const { hitLayer } = await import('/src/ui/hit-test.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const e = new ImageEngine();
    const l = layer('solid', 'Test', 64, 64);
    const values = async () => {
      const b = await e.mask(l, 64, 64);
      const c = new OffscreenCanvas(64, 64).getContext('2d')!;
      c.drawImage(b, 0, 0);
      b.close();
      return [32, 39, 45, 55].map((x) => c.getImageData(x, 32, 1, 1).data[3]);
    };
    l.maskStrokes = [{ points: [[32, 32]], size: 32, softness: 1, opacity: 1, restore: false }];
    const soft = await values();
    l.maskStrokes[0].softness = 0;
    l.maskStrokes[0].opacity = 0.5;
    l.maskStrokes[0].points = [
      [28, 32],
      [36, 32],
      [28, 32],
    ];
    const half = await values();
    l.mask = { x: 0, y: 0, width: 16, height: 64 };
    l.maskStrokes = [
      {
        points: [[32, 32]],
        size: 16,
        softness: 0,
        opacity: 1,
        restore: true,
        clip: [
          [30, 0],
          [34, 0],
          [34, 64],
          [30, 64],
        ],
      },
    ];
    const restored = await values();
    const doc = {
      version: 1 as const,
      id: 'd',
      name: 'd',
      width: 64,
      height: 64,
      layers: [l],
      selection: null,
    };
    const hits = [!!hitLayer(doc, new Assets(), 32, 32), !!hitLayer(doc, new Assets(), 39, 32)];
    l.maskDisabled = true;
    hits.push(!!hitLayer(doc, new Assets(), 39, 32));
    const canvas = new OffscreenCanvas(64, 64),
      ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 16, 64);
    const base = canvas.transferToImageBitmap();
    l.mask = null;
    l.maskStrokes = [];
    l.maskDisabled = false;
    const b = await e.mask(l, 64, 64, base);
    ctx.clearRect(0, 0, 64, 64);
    ctx.drawImage(b, 0, 0);
    const bitmapAlpha = [
      ctx.getImageData(8, 32, 1, 1).data[3],
      ctx.getImageData(32, 32, 1, 1).data[3],
    ];
    b.close();
    base.close();
    e.dispose();
    return { soft, half, restored, hits, bitmapAlpha };
  });
  expect(result.soft[0]).toBeLessThan(25);
  expect(result.soft[1]).toBeGreaterThan(90);
  expect(result.soft[2]).toBeGreaterThan(result.soft[1]);
  expect(result.soft[3]).toBe(255);
  expect(result.half[0]).toBeGreaterThanOrEqual(127);
  expect(result.half[0]).toBeLessThanOrEqual(128);
  expect(result.restored).toEqual([255, 0, 0, 0]);
  expect(result.hits).toEqual([true, false, true]);
  expect(result.bitmapAlpha).toEqual([255, 0]);
});

test('painted masks follow layer transforms and group masks bake into PSD exports', async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer/renderer.ts');
    const { ImageEngine } = await import('/src/engine/engine.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const { layer, newDocument } = await import('/src/model/document.ts');
    const { savePsd, openPsd } = await import('/src/model/psd.ts');
    const e = new ImageEngine(),
      a = new Assets();
    const renderer = await Renderer.create(document.createElement('canvas'), e);
    const d = newDocument(64, 64),
      l = layer('solid', 'Photo', 32, 32);
    l.color = '#ff0000';
    l.transform = { x: 16, y: 16, width: 32, height: 32, rotation: 90 };
    l.maskStrokes = [{ points: [[8, 16]], size: 12, softness: 0, opacity: 1, restore: false }];
    d.layers = [l];
    await renderer.render(d, a);
    const pixels = await renderer.pixels();
    const transformed = [pixels[(24 * 64 + 32) * 4 + 3], pixels[(40 * 64 + 32) * 4 + 3]];
    const g = layer('group', 'Group', 64, 64);
    g.children = [l];
    g.maskStrokes = [{ points: [[32, 40]], size: 12, softness: 0, opacity: 1, restore: false }];
    d.layers = [g];
    await renderer.render(d, a);
    const before = await renderer.pixels();
    const blob = await savePsd(d, async (doc) => {
      await renderer.render(doc, a);
      return renderer.pixels();
    });
    const loaded = await openPsd(blob, 'masks.psd');
    await renderer.render(loaded.document, loaded.assets);
    const after = await renderer.pixels();
    const equal = before.every((value, i) => value === after[i]);
    const groupHole = before[(40 * 64 + 32) * 4 + 3];
    loaded.assets.clear();
    a.clear();
    renderer.dispose();
    e.dispose();
    return { transformed, equal, groupHole };
  });
  expect(result.transformed).toEqual([0, 255]);
  expect(result.groupHole).toBe(0);
  expect(result.equal).toBe(true);
});
