import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { boot, idle, openImage, run, start, type Backend } from './helpers';
import { parseCubeLut, sampleCubeLut } from '../../src/imaging/adjust/cube';

/** Make a 4×4 32-bit document whose pixels are linear (2, 0.5, 0.1). */
async function hdrDocument(page: Page) {
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newDocument, layer } = await import('/src/model/document.ts');
    const s = e.sessionForOpen();
    await e.renderer.settle();
    const doc = newDocument(4, 4, 'HDR');
    doc.bitsPerChannel = 32;
    const img = layer('image', 'Light', 4, 4);
    const data = new Float32Array(64);
    for (let i = 0; i < 16; i++) data.set([2, 0.5, 0.1, 1], i * 4);
    img.asset = await s.assets.addRaster({ width: 4, height: 4, data });
    img.assetColorSpace = 'document';
    doc.layers = [img];
    s.history.reset(doc);
    s.hasDocument = true;
    s.storage.reset();
    s.saved = s.doc;
    s.fileName = 'HDR.photo';
    e.fit();
    e.update();
  });
  await idle(page);
}

/** The presented canvas (display) pixel and the stored composite pixel. */
async function shownAndStored(page: Page) {
  return page.evaluate(async () => {
    const e = window.photoStudio;
    const shown = await new Promise<number[]>((resolve) => {
      const listener = (canvas: HTMLCanvasElement) => {
        e.renderer.frameListeners.delete(listener);
        const c = new OffscreenCanvas(canvas.width, canvas.height);
        const g = c.getContext('2d')!;
        g.drawImage(canvas, 0, 0);
        resolve([...g.getImageData(1, 1, 1, 1).data]);
      };
      e.renderer.frameListeners.add(listener);
      e.update();
    });
    const stored = await e.renderer.documentPixels(e.doc, e.assets);
    return { shown, stored: [...stored.slice(0, 4)] };
  });
}

for (const backend of ['WebGPU', 'WebGL'] as Backend[]) {
  test(`32-bit preview options change the display only (${backend})`, async ({ page }) => {
    await boot(page, backend);
    await hdrDocument(page);
    const before = await shownAndStored(page);
    // White-clipped red, partly bright green.
    expect(before.shown[0]).toBe(255);
    expect(before.stored.map((v) => +v.toFixed(4))).toEqual([2, 0.5, 0.1, 1]);
    await start(page, 'view.hdr-preview-options');
    const dialog = page.locator('dialog.hdr-preview-dialog');
    await expect(dialog).toBeVisible();
    const exposure = dialog.locator('.adj-slider').filter({ hasText: 'Exposure' }).locator('input[type=number]');
    await exposure.fill('-1');
    await exposure.dispatchEvent('change');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await idle(page);
    expect(await page.evaluate(() => window.photoStudio.doc.hdrPreview)).toMatchObject({ method: 'exposure-gamma', exposure: -1 });
    const after = await shownAndStored(page);
    // Exposure -1 halves linear values: red 2 -> 1 stays white, green darkens.
    expect(after.shown[0]).toBe(255);
    expect(after.shown[1]).toBeLessThan(before.shown[1] - 20);
    expect(Math.abs(after.shown[1] - Math.round(255 * (1.055 * Math.pow(0.25, 1 / 2.4) - 0.055)))).toBeLessThanOrEqual(2);
    expect(after.stored).toEqual(before.stored);
    // Highlight compression brings red below white.
    await page.evaluate(() => window.photoStudio.command('Preview', (d) => (d.hdrPreview = { method: 'highlight-compression', exposure: 0, gamma: 1, white: 8 })));
    await idle(page);
    const compressed = await shownAndStored(page);
    expect(compressed.shown[0]).toBeLessThan(255);
    expect(compressed.stored).toEqual(before.stored);
    // Undo restores the plain display.
    await run(page, 'edit.undo');
    await run(page, 'edit.undo');
    expect(await page.evaluate(() => window.photoStudio.doc.hdrPreview)).toBeUndefined();
  });
}

test('multichannel round trip keeps the image and shows ink channels', async ({ page }) => {
  await boot(page);
  await openImage(page, 8, 6, '#4080c0');
  await run(page, 'image.mode-multichannel');
  const state = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    const img = await compositeRGBA(e);
    return {
      mode: e.doc.mode,
      layers: e.doc.layers.map((l) => [l.name, l.locked]),
      channels: (e.doc.channels ?? []).map((c) => [c.name, c.color, c.spot]),
      pixel: [...img.data.slice(0, 4)],
    };
  });
  expect(state.mode).toBe('multichannel');
  expect(state.layers).toEqual([['Multichannel', true]]);
  expect(state.channels).toEqual([['Cyan', '#00ffff', true], ['Magenta', '#ff00ff', true], ['Yellow', '#ffff00', true]]);
  expect(state.pixel).toEqual([0x40, 0x80, 0xc0, 255]);
  // The Channels panel lists the inks; hiding cyan removes its ink.
  await page.evaluate(() => window.photoStudio.dock.show('channels'));
  const rows = page.locator('.panel-body[aria-label="Channels"] .channel-row');
  await expect(rows).toHaveCount(3);
  await rows.first().locator('[data-spot-eye]').click();
  await idle(page);
  const hidden = await page.evaluate(async () => {
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    return [...(await compositeRGBA(window.photoStudio)).data.slice(0, 4)];
  });
  expect(hidden).toEqual([255, 0x80, 0xc0, 255]);
  await run(page, 'edit.undo');
  // Survives a save and reload.
  const reloaded = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const { document } = await deserialize(await serialize(e.doc, e.assets));
    return { mode: document.mode, spots: (document.channels ?? []).filter((c) => c.spot).length, layer: document.modeData?.multichannelLayer === e.doc.layers[0].id };
  });
  expect(reloaded).toEqual({ mode: 'multichannel', spots: 3, layer: true });
  await run(page, 'image.mode-rgb');
  const back = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    return { mode: e.doc.mode, channels: e.doc.channels?.length ?? 0, locked: e.doc.layers[0].locked, pixel: [...(await compositeRGBA(e)).data.slice(0, 4)] };
  });
  expect(back).toEqual({ mode: undefined, channels: 0, locked: false, pixel: [0x40, 0x80, 0xc0, 255] });
});

test('import layers adds a .photo or PSD file as a group', async ({ page }) => {
  await boot(page);
  await openImage(page, 20, 10, '#ffffff');
  const result = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { Assets } = await import('/src/model/assets.ts');
    const { newDocument } = await import('/src/model/document.ts');
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const { serialize } = await import('/src/model/serialization.ts');
    const { importLayersFrom } = await import('/src/features/files/import-layers.ts');
    const assets = new Assets();
    const doc = newDocument(20, 10, 'Parts');
    const solid = (w: number, h: number, rgb: number[]) => ({ width: w, height: h, data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])) });
    const red = newPixelLayer('Red', doc, gridFromImage(assets.tiles, solid(5, 5, [255, 0, 0])));
    const blue = newPixelLayer('Blue', doc, gridFromImage(assets.tiles, solid(4, 4, [0, 0, 255]), 10, 2));
    blue.opacity = 0.5;
    doc.layers = [red, blue];
    await importLayersFrom(e, await serialize(doc, assets), 'Parts.photo');
    // A second import gets fresh layer IDs.
    await importLayersFrom(e, await serialize(doc, assets), 'Parts.photo');
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    const img = await compositeRGBA(e);
    const at = (x: number, y: number) => [...img.data.slice((y * 20 + x) * 4, (y * 20 + x) * 4 + 4)];
    const groups = e.doc.layers.filter((l) => l.kind === 'group');
    const ids = groups.flatMap((g) => g.children.map((c) => c.id));
    return { groups: groups.map((g) => [g.name, g.children.map((c) => [c.name, c.opacity])]), unique: new Set(ids).size === ids.length, red: at(1, 1), blue: at(11, 3) };
  });
  expect(result.groups).toEqual([['Parts', [['Red', 1], ['Blue', 0.5]]], ['Parts', [['Red', 1], ['Blue', 0.5]]]]);
  expect(result.unique).toBe(true);
  expect(result.red).toEqual([255, 0, 0, 255]);
  // Two half-opaque blue layers over white.
  expect(result.blue[2]).toBe(255);
  expect(Math.abs(result.blue[0] - 64)).toBeLessThanOrEqual(2);
  await run(page, 'edit.undo');
  expect(await page.evaluate(() => window.photoStudio.doc.layers.filter((l) => l.kind === 'group').length)).toBe(1);
  // PSD files go through the PSD reader.
  const psd = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { writePsd } = await import('/tests/browser/psd-codec.ts');
    const data = new Uint8ClampedArray(3 * 3 * 4).fill(255);
    for (let i = 0; i < data.length; i += 4) data[i + 1] = data[i + 2] = 0;
    const bytes = writePsd({ width: 20, height: 10, children: [{ name: 'Mark', left: 2, top: 4, imageData: { width: 3, height: 3, data } }] } as never);
    const { importLayersFrom } = await import('/src/features/files/import-layers.ts');
    await importLayersFrom(e, new Blob([bytes]), 'Marks.psd');
    const top = e.doc.layers.at(-1)!;
    return [top.kind, top.name, top.children.map((c) => c.name)];
  });
  expect(psd).toEqual(['group', 'Marks', ['Mark']]);
});

test('color lookup export bakes the adjustment layers', async ({ page }) => {
  await boot(page);
  await openImage(page, 8, 8, '#808080');
  await run(page, 'layer.adj-invert');
  await start(page, 'file.export-color-lookup');
  const dialog = page.locator('#dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('select[name=size]').selectOption('17');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.cube$/);
  const lut = parseCubeLut(await readFile((await file.path())!, 'utf8'));
  expect(lut.size).toBe(17);
  const out = [0, 0, 0];
  sampleCubeLut(lut, 0.25, 0.5, 1, out);
  expect(out.map((v) => +v.toFixed(4))).toEqual([0.75, 0.5, 0]);
  await idle(page);
});
