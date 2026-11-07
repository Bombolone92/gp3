import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeRgbProfile } from '../color-fixtures';
import { linearSrgbProfile } from '../../src/color/profile';
import { canvasClick, downloadFrom, menu, openFiles, tool } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.puter={env:"app",auth:{isSignedIn:()=>true}};',
    }),
  );
  await page.goto('/');
  await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
});

test('HDR display clips to the screen gamut before premultiplying alpha', async ({
  page,
}) => {
  for (const webgl of [false, true]) {
    if (webgl)
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }),
      );
    for (const depth of [16, 32] as const) {
      await page.evaluate(async (depth) => {
        const { Renderer } = await import('/src/renderer/renderer.ts');
        const { ImageEngine } = await import('/src/engine/engine.ts');
        const { Assets } = await import('/src/model/assets.ts');
        const { newDocument, layer } = await import('/src/model/document.ts');
        const host = document.createElement('div');
        host.id = 'hdr-screen-reference';
        host.style.cssText =
          'position:fixed;left:10px;top:10px;width:40px;height:40px;background:#000;z-index:9999';
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:40px;height:40px;display:block';
        host.append(canvas);
        document.body.append(host);
        const doc = newDocument(1, 1);
        doc.bitsPerChannel = depth;
        const assets = new Assets(),
          engine = new ImageEngine(),
          renderer = await Renderer.create(canvas, engine);
        const image = layer('image', 'HDR alpha', 1, 1);
        image.asset = await assets.addRaster({
          width: 1,
          height: 1,
          data: new Float32Array([0, 4, 0, 0.37]),
        });
        doc.layers = [image];
        await renderer.render(doc, assets);
        await renderer.rawPixels();
        (globalThis as unknown as { cleanupHdr: () => void }).cleanupHdr = () => {
          renderer.dispose();
          assets.clear();
          engine.dispose();
          host.remove();
        };
      }, depth);
      const screenshot = await page.locator('#hdr-screen-reference').screenshot();
      const pixel = await page.evaluate(async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 40;
        const c = canvas.getContext('2d')!;
        c.drawImage(bitmap, 0, 0);
        bitmap.close();
        return Array.from(c.getImageData(20, 20, 1, 1).data);
      }, Array.from(screenshot));
      await page.evaluate(() =>
        (globalThis as unknown as { cleanupHdr: () => void }).cleanupHdr(),
      );
      expect(pixel[0]).toBe(0);
      expect(pixel[2]).toBe(0);
      expect(pixel[3]).toBe(255);
      expect(Math.abs(pixel[1] - Math.round(255 * 0.37))).toBeLessThanOrEqual(1);
    }
  }
});

test('source thumbnail conversion follows profile, depth and source provenance without changing asset bytes', async ({
  page,
}) => {
  const profile = Array.from(makeRgbProfile({ curves: linearSrgbProfile.curves }));
  const result = await page.evaluate(async (profile) => {
    const { sourceThumbnail } = await import('/src/ui/thumbnails.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const { ImageEngine } = await import('/src/engine/engine.ts');
    const { newDocument, layer } = await import('/src/model/document.ts');
    const { encodeIccProfile } = await import('/src/model/psd-resources.ts');
    const assets = new Assets(),
      engine = new ImageEngine(),
      doc = newDocument(1, 1);
    const image = layer('image', 'Encoded pixels', 1, 1);
    const blob = await engine.png(new Uint8Array([128, 64, 32, 255]), 1, 1);
    image.asset = await assets.add(blob);
    const decode = async (url: string) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const c = canvas.getContext('2d')!;
      c.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(c.getImageData(0, 0, 1, 1).data);
    };
    try {
      doc.iccProfile = encodeIccProfile(new Uint8Array(profile));
      const first = sourceThumbnail(image, assets, doc);
      const converted = await decode(first);
      const reused = first === sourceThumbnail(image, assets, structuredClone(doc));
      image.assetColorSpace = 'srgb';
      const srgb = await decode(sourceThumbnail(image, assets, doc));
      image.assetColorSpace = 'document';
      doc.iccUntaggedProfile = true;
      const untagged = await decode(sourceThumbnail(image, assets, doc));
      doc.iccProfile = undefined;
      doc.bitsPerChannel = 32;
      const hdr = await decode(sourceThumbnail(image, assets, doc));
      doc.bitsPerChannel = 16;
      const integer = await decode(sourceThumbnail(image, assets, doc));
      const unchanged = Array.from(
        new Uint8Array(await assets.blob(image.asset).arrayBuffer()),
      );
      return {
        converted,
        srgb,
        untagged,
        hdr,
        integer,
        reused,
        unchanged,
        original: Array.from(new Uint8Array(await blob.arrayBuffer())),
      };
    } finally {
      assets.clear();
      engine.dispose();
    }
  }, profile);
  expect(result.converted).toEqual([188, 137, 99, 255]);
  expect(result.hdr).toEqual([188, 137, 99, 255]);
  expect(result.srgb).toEqual([128, 64, 32, 255]);
  expect(result.untagged).toEqual(result.srgb);
  expect(result.integer).toEqual(result.srgb);
  expect(result.unchanged).toEqual(result.original);
  expect(result.reused).toBe(true);
});

test('many-layer previews are deferred until visible and stale thumbnail jobs are cancelled', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const { layerList } = await import('/src/ui/panels.ts');
    const { hydrateSourceThumbnails } = await import('/src/ui/thumbnails.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const { newDocument, layer } = await import('/src/model/document.ts');
    const assets = new Assets(),
      doc = newDocument(1, 1);
    doc.bitsPerChannel = 32;
    for (let i = 0; i < 200; i++) {
      const image = layer('image', `Source ${i}`, 1, 1);
      image.asset = await assets.addRaster({
        width: 1,
        height: 1,
        data: new Float32Array([0.25, 0.5, 0.75, 1]),
      });
      doc.layers.push(image);
    }
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;left:0;top:0;width:200px;height:100px;z-index:9999';
    root.innerHTML = '<div id="layers" style="height:100px;overflow:auto"></div>';
    document.body.append(root);
    const list = root.querySelector<HTMLElement>('#layers')!;
    list.innerHTML = layerList(doc.layers, new Set(), assets, new Set(), 0, '', doc);
    const images = Array.from(
      list.querySelectorAll<HTMLImageElement>('.layer-thumbnail img'),
    );
    const initiallyDeferred = images.every((image) => !image.hasAttribute('src'));
    hydrateSourceThumbnails(root, doc, assets);
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
    const visibleLoaded = images[0].naturalWidth;
    const offscreenDeferred = images.at(-1)!.naturalWidth === 0;
    list.scrollTop = list.scrollHeight;
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
    const afterScroll = images.at(-1)!.naturalWidth;
    // Replace rows and clear their source store before the queued frame runs.
    list.innerHTML = layerList(doc.layers, new Set(), assets, new Set(), 0, '', {
      ...doc,
      iccUntaggedProfile: true,
      bitsPerChannel: 16,
    });
    hydrateSourceThumbnails(root, { ...doc, bitsPerChannel: 16 }, assets);
    const replacement = new Assets();
    list.innerHTML = '';
    hydrateSourceThumbnails(root, newDocument(1, 1), replacement);
    assets.clear();
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    root.remove();
    replacement.clear();
    return { initiallyDeferred, visibleLoaded, offscreenDeferred, afterScroll };
  });
  expect(result).toEqual({
    initiallyDeferred: true,
    visibleLoaded: 1,
    offscreenDeferred: true,
    afterScroll: 1,
  });
  expect(errors).toEqual([]);
});

test('high-depth document compositing preserves samples through nested groups, masks, history and depth changes', async ({
  page,
}) => {
  const results = [];
  for (const webgl of [false, true]) {
    if (webgl)
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }),
      );
    results.push(
      ...(await page.evaluate(async () => {
        const { Renderer } = await import('/src/renderer/renderer.ts');
        const { Assets } = await import('/src/model/assets.ts');
        const { ImageEngine } = await import('/src/engine/engine.ts');
        const { layer, newDocument } = await import('/src/model/document.ts');
        const { serialize, deserialize } = await import('/src/model/serialization.ts');
        const { History } = await import('/src/history/history.ts');
        const engine = new ImageEngine(),
          renderer = await Renderer.create(document.createElement('canvas'), engine);
        const results = [];
        try {
          for (const depth of [16, 32] as const)
            for (const [w, h] of [
              [3, 2],
              [7, 5],
            ]) {
              const assets = new Assets(),
                doc = newDocument(w, h);
              doc.bitsPerChannel = depth;
              const back = layer('image', 'Backdrop', w, h);
              const foreground = layer('image', 'Source', w, h);
              foreground.transform.x = -1;
              foreground.transform.y = 1;
              foreground.opacity = 0.73;
              const data =
                depth === 16 ? new Uint16Array(w * h * 4) : new Float32Array(w * h * 4);
              const backdrop = new Float32Array(w * h * 4);
              for (let i = 0; i < data.length; i += 4) {
                data.set(
                  depth === 16
                    ? [1 + i, 32768 + i, 65534 - i, i % 3 ? 65535 : 37]
                    : [2 + i * 0.013, -0.25, 0.001234567, i % 3 ? 0.71 : 1e-9],
                  i,
                );
                backdrop.set(
                  depth === 16 ? [0.8, 0.1, 0.001, 1] : [1.5, -0.125, 0.001, 1],
                  i,
                );
              }
              foreground.asset = await assets.addRaster({ width: w, height: h, data });
              foreground.maskAsset = await assets.add(
                await engine.png(new Uint8Array([255, 255, 255, 128]), 1, 1),
              );
              back.asset = await assets.addRaster({
                width: w,
                height: h,
                data: backdrop,
              });
              const outer = layer('group', 'Outer', w, h),
                inner = layer('group', 'Inner', w, h);
              outer.opacity = 0.62;
              outer.blend = 'multiply';
              inner.opacity = 0.89;
              inner.children = [foreground];
              outer.children = [inner];
              doc.layers = [back, outer];
              const history = new History(doc);
              history.execute('Move', (d) => {
                d.layers[1].children[0].children[0].transform.x = 0;
              });
              history.undo();
              const project = await deserialize(
                await serialize(history.document, assets),
              );
              try {
                await renderer.render(project.document, project.assets);
                const raw = await renderer.rawPixels();
                const display = await renderer.displayPixels();
                const source = await renderer.rawSourcePixels(foreground, project.assets);
                await renderer.render(
                  { ...project.document, bitsPerChannel: 8 },
                  project.assets,
                );
                const byte = await renderer.rawPixels();
                await renderer.render(project.document, project.assets);
                const again = await renderer.rawPixels();
                results.push({
                  backend: renderer.name,
                  depth,
                  w,
                  h,
                  data: Array.from(data),
                  backdrop: Array.from(backdrop),
                  raw: Array.from(raw),
                  display: Array.from(display),
                  source: Array.from(source.data),
                  again: Array.from(again),
                  floatType: raw instanceof Float32Array,
                  byteType: byte instanceof Uint8Array,
                  savedDepth: project.document.bitsPerChannel,
                });
              } finally {
                project.assets.clear();
                assets.clear();
              }
            }
        } finally {
          renderer.dispose();
          engine.dispose();
        }
        return results;
      })),
    );
  }
  const srgb = (x: number) =>
    x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  for (const result of results) {
    expect(result.floatType).toBe(true);
    expect(result.byteType).toBe(true);
    expect(result.savedDepth).toBe(result.depth);
    expect(result.again).toEqual(result.raw);
    for (let i = 0; i < result.source.length; i++)
      expect(result.source[i]).toBeCloseTo(
        result.data[i] / (result.depth === 16 ? 65535 : 1),
        7,
      );
    for (let y = 0; y < result.h; y++)
      for (let x = 0; x < result.w; x++) {
        const i = (y * result.w + x) * 4;
        const sourceAt = ((y - 1) * result.w + x + 1) * 4;
        const covered = y >= 1 && x + 1 < result.w;
        const alpha = covered
          ? (result.data[sourceAt + 3] / (result.depth === 16 ? 65535 : 1)) *
            0.73 *
            (128 / 255) *
            0.89 *
            0.62
          : 0;
        for (let c = 0; c < 3; c++) {
          const b = result.backdrop[i + c];
          const s = covered
            ? result.data[sourceAt + c] / (result.depth === 16 ? 65535 : 1)
            : 0;
          const expected = b * (1 - alpha) + b * s * alpha;
          expect(
            result.raw[i + c],
            `${result.backend} ${result.depth} (${x},${y}) channel ${c}`,
          ).toBeCloseTo(expected, 6);
          const code = Math.round(
            Math.max(0, Math.min(1, result.depth === 32 ? srgb(expected) : expected)) *
              255,
          );
          expect(Math.abs(result.display[i + c] - code)).toBeLessThanOrEqual(1);
        }
        expect(result.raw[i + 3]).toBe(1);
      }
  }
});

test('16-bit range clipping and float source/color conversions retain sub-byte precision', async ({
  page,
}) => {
  const profile = Array.from(
    makeRgbProfile({
      curves: [
        { kind: 'parametric', type: 0, parameters: [1] },
        { kind: 'parametric', type: 0, parameters: [1] },
        { kind: 'parametric', type: 0, parameters: [1] },
      ],
    }),
  );
  const results = [];
  for (const webgl of [false, true]) {
    if (webgl)
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }),
      );
    results.push(
      ...(await page.evaluate(async (profile) => {
        const { Renderer } = await import('/src/renderer/renderer.ts');
        const { Assets } = await import('/src/model/assets.ts');
        const { ImageEngine } = await import('/src/engine/engine.ts');
        const { layer, newDocument } = await import('/src/model/document.ts');
        const { encodeIccProfile } = await import('/src/model/psd-resources.ts');
        const assets = new Assets(),
          engine = new ImageEngine(),
          renderer = await Renderer.create(document.createElement('canvas'), engine);
        const results = [];
        try {
          const doc = newDocument(1, 1),
            image = layer('image', 'Precise', 1, 1);
          image.asset = await assets.addRaster({
            width: 1,
            height: 1,
            data: new Float32Array([-0.25, 1.25, 0.1234567, 0.37]),
          });
          doc.layers = [image];
          for (const depth of [16, 32] as const) {
            doc.bitsPerChannel = depth;
            await renderer.render(doc, assets);
            results.push({
              backend: renderer.name,
              depth,
              clipping: Array.from(await renderer.rawPixels()),
              display: Array.from(await renderer.displayPixels()),
            });
          }
          doc.iccProfile = encodeIccProfile(new Uint8Array(profile));
          doc.bitsPerChannel = 32;
          const solid = layer('solid', 'sRGB edit', 1, 1);
          solid.color = '#804020';
          doc.layers = [solid];
          await renderer.render(doc, assets);
          results.push({
            backend: renderer.name,
            color: Array.from(await renderer.rawPixels()),
            display: Array.from(await renderer.displayPixels()),
          });
          // Identical IDs in another project must not reuse this project's source texture.
          doc.iccProfile = undefined;
          doc.layers = [image];
          const other = new Assets();
          await other.addRaster(
            { width: 1, height: 1, data: new Float32Array([0.25, 0.5, 0.75, 1]) },
            image.asset,
          );
          await renderer.render(doc, other);
          results.push({
            backend: renderer.name,
            replacement: Array.from(await renderer.rawPixels()),
          });
          other.clear();
        } finally {
          renderer.dispose();
          assets.clear();
          engine.dispose();
        }
        return results;
      }, profile)),
    );
  }
  const decode = (x: number) =>
    x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  for (const r of results) {
    if ('clipping' in r) {
      const expected =
        r.depth === 16 ? [0, 1, 0.1234567, 0.37] : [-0.25, 1.25, 0.1234567, 0.37];
      expected.forEach((n, i) => expect(r.clipping[i]).toBeCloseTo(n, 6));
      // A byte preview retains straight RGB at partial alpha, on both backends.
      expect(r.display[3]).toBe(94);
      expect(r.display[1]).toBe(255);
    } else if ('color' in r) {
      [128, 64, 32].forEach((n, i) => expect(r.color[i]).toBeCloseTo(decode(n / 255), 4));
      expect(r.display).toEqual([128, 64, 32, 255]);
    } else expect(r.replacement).toEqual([0.25, 0.5, 0.75, 1]);
  }
});

test('HDR project UI, thumbnails and connected selections preserve editable native samples', async ({
  page,
}) => {
  const bytes = await page.evaluate(async () => {
    const { newDocument, layer } = await import('/src/model/document.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const { serialize } = await import('/src/model/serialization.ts');
    const doc = newDocument(3, 1, 'HDR project'),
      assets = new Assets();
    doc.bitsPerChannel = 32;
    const image = layer('image', 'HDR pixels', 3, 1);
    image.asset = await assets.addRaster({
      width: 3,
      height: 1,
      data: new Float32Array([2, -1, 0.25, 1, 2, -1, 0.25, 1, 4, -2, 0.25, 1]),
    });
    doc.layers = [image];
    try {
      return Array.from(
        new Uint8Array(await (await serialize(doc, assets)).arrayBuffer()),
      );
    } finally {
      assets.clear();
    }
  });
  await page.locator('#file-input').setInputFiles({
    name: 'HDR.photo',
    mimeType: 'application/x-photo-editor',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.document-mode')).toHaveText('(RGB/32)');
  await expect(page.locator('.canvas-color-mode')).toHaveText('RGB / 32');
  const thumbnail = page.locator('.layer-thumbnail img');
  await expect
    .poll(() => thumbnail.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBe(3);
  expect(
    await thumbnail.evaluate((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = 3;
      canvas.height = 1;
      const c = canvas.getContext('2d')!;
      c.drawImage(img as HTMLImageElement, 0, 0);
      return Array.from(c.getImageData(0, 0, 3, 1).data);
    }),
  ).toEqual([255, 0, 137, 255, 255, 0, 137, 255, 255, 0, 137, 255]);
  // The magic wand now makes a selection instead of a masked copy layer; the
  // HDR layer itself must stay an editable embedded raster with native samples.
  await tool(page, 'Magic Wand Tool');
  await page.locator('#tolerance').fill('0');
  await page.locator('#tolerance').press('Tab');
  await canvasClick(page, 0.5, 0.5);
  await expect.poll(() => page.evaluate(() => window.photoStudio.doc.selection)).not.toBeNull();
  await expect(page.locator('#layer-count')).toHaveText('1');
  const { bytes: saved } = await downloadFrom(page, () => menu(page, 'File', 'Download Project (.photo)'));
  const selected = await page.evaluate(async (bytes) => {
    const { deserialize } = await import('/src/model/serialization.ts');
    const loaded = await deserialize(new Blob([new Uint8Array(bytes)]));
    try {
      const layer = loaded.document.layers[0];
      return {
        count: loaded.document.layers.length,
        kind: layer.kind,
        bits: loaded.document.bitsPerChannel,
        pixels: Array.from(loaded.assets.raster(layer.asset!)!.data),
      };
    } finally {
      loaded.assets.clear();
    }
  }, Array.from(saved));
  expect(selected).toEqual({ count: 1, kind: 'image', bits: 32, pixels: [2, -1, 0.25, 1, 2, -1, 0.25, 1, 4, -2, 0.25, 1] });
});

test('magic wand distinguishes HDR samples that clip to the same display value', async ({ page }) => {
  const bytes = await page.evaluate(async () => {
    const { newDocument, layer } = await import('/src/model/document.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const { serialize } = await import('/src/model/serialization.ts');
    const doc = newDocument(3, 1, 'HDR project'),
      assets = new Assets();
    doc.bitsPerChannel = 32;
    const image = layer('image', 'HDR pixels', 3, 1);
    image.asset = await assets.addRaster({ width: 3, height: 1, data: new Float32Array([2, -1, 0.25, 1, 2, -1, 0.25, 1, 4, -2, 0.25, 1]) });
    doc.layers = [image];
    return Array.from(new Uint8Array(await (await serialize(doc, assets)).arrayBuffer()));
  });
  await openFiles(page, { name: 'HDR.photo', mimeType: 'application/x-photo-editor', buffer: Buffer.from(bytes) });
  await tool(page, 'Magic Wand Tool');
  await page.locator('#tolerance').fill('0');
  await page.locator('#tolerance').press('Tab');
  await page.evaluate(() => (window.photoStudio.settings.antiAlias = false));
  await canvasClick(page, 0.5, 0.5);
  await expect.poll(() => page.evaluate(() => window.photoStudio.doc.selection)).not.toBeNull();
  const mask = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { readMask } = await import('/src/model/tiles.ts');
    const { selectionGrid } = await import('/src/model/selection.ts');
    return Array.from(readMask(e.assets.tiles, selectionGrid(e.doc, e.assets.tiles)!, { x: 0, y: 0, width: 3, height: 1 }).data);
  });
  expect(mask).toEqual([255, 255, 0]);
});
