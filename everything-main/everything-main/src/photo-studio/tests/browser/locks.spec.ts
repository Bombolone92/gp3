import { test, expect } from '@playwright/test';
import { makeRgbProfile } from '../color-fixtures';
import { boot, canvasClick, downloadFrom, idle, layerPixel, menu, openFiles, panel, tool, undo } from './helpers';

test.beforeEach(async ({ page }) => {
  await boot(page, 'default', 'window.puter={};');
});

for (const backend of ['default', 'WebGL']) {
  test(`PSD/PSB protection bits and record flag remain independent through native and PSD export (${backend})`, async ({
    page,
  }) => {
    if (backend === 'WebGL')
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'gpu', {
          value: undefined,
          configurable: true,
        }),
      );
    const results = await page.evaluate(async () => {
      const { writePsd, readPsd } = await import('/tests/browser/psd-codec.ts');
      const { writeHighDepthPsd } =
        await import('/src/model/psd-high-depth.ts');
      const { openPsd, savePsd } = await import('/src/model/psd.ts');
      const { serialize, deserialize } =
        await import('/src/model/serialization.ts');
      const { Renderer } = await import('/src/renderer/renderer.ts');
      const { ImageEngine } = await import('/src/engine/engine.ts');
      const { layerLock } = await import('/src/model/locks.ts');
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement('canvas'),
          engine,
        ),
        results = [];
      try {
        for (const depth of [8, 16, 32] as const)
          for (const psb of [false, true]) {
            const width = 9,
              height = 7;
            const data =
              depth === 8
                ? new Uint8ClampedArray(width * height * 4)
                : depth === 16
                  ? new Uint16Array(width * height * 4)
                  : new Float32Array(width * height * 4);
            for (let i = 0; i < data.length; i += 4)
              data.set(
                depth === 8
                  ? [47, 89, 173, 255]
                  : depth === 16
                    ? [1234, 32768, 65432, 65535]
                    : [-0.125, 0.1371234, 1.25, 1],
                i,
              );
            const imageData = { width, height, data };
            const children = Array.from({ length: 32 }, (_, i) => ({
              name: `Flags ${i}`,
              imageData,
              transparencyProtected: i >= 16,
              protected: {
                transparency: !!(i & 1),
                composite: !!(i & 2),
                position: !!(i & 4),
                artboards: !!(i & 8),
              },
            }));
            const psd = {
              width,
              height,
              bitsPerChannel: depth,
              imageData,
              children,
            };
            const encoded =
              depth === 8
                ? writePsd(psd, { psb, noBackground: true })
                : writeHighDepthPsd(psd, psb);
            const loaded = await openPsd(
              new Blob([encoded]),
              'Flags.psd',
              engine,
            );
            let native, reopened;
            try {
              native = await deserialize(
                await serialize(loaded.document, loaded.assets),
              );
              await renderer.render(native.document, native.assets);
              const output = await savePsd(
                native.document,
                async (d) => {
                  await renderer.render(d, native.assets);
                  return renderer.rawPixels();
                },
                (l) => renderer.rawSourcePixels(l, native.assets),
                (id) => native.assets.blob(id),
              );
              const decoded = readPsd(await output.arrayBuffer(), {
                skipCompositeImageData: true,
                skipLayerImageData: true,
              });
              reopened = await openPsd(output, 'Again.psd', engine);
              results.push({
                depth,
                psb,
                flags: decoded.children!.map((l) => [
                  !!l.transparencyProtected,
                  !!l.protected?.transparency,
                  !!l.protected?.composite,
                  !!l.protected?.position,
                  !!l.protected?.artboards,
                ]),
                nativeExact:
                  JSON.stringify(native.document) ===
                  JSON.stringify(loaded.document),
                behavior: reopened.document.layers.map((l) =>
                  ['all', 'pixels', 'position', 'transparency'].map((op) =>
                    layerLock(
                      reopened!.document.layers,
                      l.id,
                      op as 'all' | 'pixels' | 'position' | 'transparency',
                    ),
                  ),
                ),
              });
            } finally {
              loaded.assets.clear();
              native?.assets.clear();
              reopened?.assets.clear();
            }
          }
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return results;
    });
    for (const r of results) {
      expect(r.nativeExact).toBe(true);
      expect(r.flags).toEqual(
        Array.from({ length: 32 }, (_, i) => [
          i >= 16,
          !!(i & 1),
          !!(i & 2),
          !!(i & 4),
          !!(i & 8),
        ]),
      );
      expect(r.behavior).toEqual(
        Array.from({ length: 32 }, (_, i) => [
          (i & 7) === 7,
          !!(i & 2),
          !!(i & 4),
          i >= 16 || !!(i & 1),
        ]),
      );
    }
  });

  test(`alpha-protected painting preserves native alpha, HDR and document color semantics (${backend})`, async ({
    page,
  }) => {
    if (backend === 'WebGL')
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'gpu', {
          value: undefined,
          configurable: true,
        }),
      );
    const profile = Array.from(
      makeRgbProfile({
        curves: [0, 1, 2].map(() => ({
          kind: 'parametric' as const,
          type: 0,
          parameters: [1],
        })),
      }),
    );
    const results = await page.evaluate(async (profile) => {
      const { Renderer } = await import('/src/renderer/renderer.ts');
      const { ImageEngine } = await import('/src/engine/engine.ts');
      const { layer, newDocument } = await import('/src/model/document.ts');
      const { Assets } = await import('/src/model/assets.ts');
      const { serialize, deserialize } =
        await import('/src/model/serialization.ts');
      const { hitLayer } = await import('/src/ui/hit-test.ts');
      const { savePsd, openPsd } = await import('/src/model/psd.ts');
      const { encodeIccProfile } = await import('/src/model/psd-resources.ts');
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement('canvas'),
          engine,
        ),
        results = [];
      try {
        for (const depth of [8, 16, 32] as const)
          for (const [width, height] of [
            [3, 2],
            [17, 3],
          ]) {
            const assets = new Assets(),
              doc = newDocument(width, height),
              paint = layer('image', 'Editable source', width, height);
            doc.bitsPerChannel = depth;
            const linear = depth === 32 || (depth === 16 && width === 17);
            if (depth === 16 && width === 17)
              doc.iccProfile = encodeIccProfile(new Uint8Array(profile));
            const data =
              depth === 8
                ? new Uint8Array(width * height * 4)
                : depth === 16
                  ? new Uint16Array(width * height * 4)
                  : new Float32Array(width * height * 4);
            const alphas =
              depth === 8
                ? [0, 1, 94, 255]
                : depth === 16
                  ? [0, 1, 24248, 65535]
                  : [0, 1e-20, 0.37, 1, 1.401298464324817e-45, -0];
            for (let i = 0; i < data.length / 4; i++)
              data.set(
                depth === 8
                  ? [47, 89, 173, alphas[i % alphas.length]]
                  : depth === 16
                    ? [1234, 32768, 65432, alphas[i % alphas.length]]
                    : [-0.125, 1.25, 0.1371234, alphas[i % alphas.length]],
                i * 4,
              );
            paint.asset =
              depth === 8
                ? await assets.add(
                    await engine.png(
                      (data as Uint8Array).slice(),
                      width,
                      height,
                    ),
                  )
                : await assets.addRaster({
                    width,
                    height,
                    data: data as Uint16Array | Float32Array,
                  });
            const stroke = {
              points: [[width / 2 + 0.25, height / 2 - 0.125]] as [
                number,
                number,
              ][],
              size: height + 0.75,
              color: width === 3 ? '#ff0000' : '#804020',
              preserveAlpha: true,
            };
            paint.strokes = [stroke];
            doc.layers = [paint];
            let native, reopened;
            try {
              // Read the unchanged ordinary brush raster path as input. The
              // expected protected RGB/alpha and profile conversion use scalar
              // arithmetic independent of the new GPU painting operation.
              const stampDoc = newDocument(width, height),
                stampLayer = layer('paint', 'Stamp', width, height);
              stampLayer.strokes = [{ ...stroke, preserveAlpha: false }];
              stampDoc.layers = [stampLayer];
              await renderer.render(stampDoc, assets);
              const stampData = Array.from(
                (await renderer.rawSourcePixels(stampLayer, assets)).data,
              );
              const coverage = stampData
                .filter((_, i) => i % 4 === 3)
                .map((a) => a / 255);
              await renderer.render(doc, assets);
              const source = await renderer.rawSourcePixels(paint, assets);
              const raw = await renderer.rawPixels();
              native = await deserialize(await serialize(doc, assets));
              await renderer.render(native.document, native.assets);
              const nativeSource = await renderer.rawSourcePixels(
                native.document.layers[0],
                native.assets,
              );
              const output = await savePsd(
                native.document,
                async (d) => {
                  await renderer.render(d, native.assets);
                  return renderer.rawPixels();
                },
                (l) => renderer.rawSourcePixels(l, native.assets),
                (id) => native.assets.blob(id),
              );
              reopened = await openPsd(output, 'Painted.psd', engine);
              await renderer.render(reopened.document, reopened.assets);
              const reopenedSource = await renderer.rawSourcePixels(
                reopened.document.layers[0],
                reopened.assets,
              );
              paint.opacity = 0.7;
              paint.mask = { x: 0, y: 0, width: Math.ceil(width / 2), height };
              const group = layer('group', 'Masked group', width, height);
              group.opacity = 0.6;
              group.children = [paint];
              doc.layers = [group];
              await renderer.render(doc, assets);
              const masked = Array.from(await renderer.rawPixels());
              const sourceAfterMask = Array.from(
                (await renderer.rawSourcePixels(paint, assets)).data,
              );
              // New unlocked painting may grow coverage; changing current protection
              // cannot change the captured semantics of the earlier stroke.
              paint.protection = {
                transparency: false,
                composite: false,
                position: false,
              };
              await renderer.render(doc, assets);
              const unchanged = await renderer.rawSourcePixels(paint, assets);
              paint.strokes.push({ ...stroke, preserveAlpha: false });
              await renderer.render(doc, assets);
              const unlocked = await renderer.rawSourcePixels(paint, assets);
              results.push({
                depth,
                width,
                height,
                linear,
                stampData,
                backend: renderer.name,
                data: Array.from(data),
                coverage,
                source: Array.from(source.data),
                nativeSource: Array.from(nativeSource.data),
                reopenedSource: Array.from(reopenedSource.data),
                raw: Array.from(raw),
                masked,
                sourceAfterMask,
                unchanged: Array.from(unchanged.data),
                unlocked: Array.from(unlocked.data),
                hits: Array.from(
                  { length: width * height },
                  (_, i) =>
                    !!hitLayer(
                      native!.document,
                      native!.assets,
                      (i % width) + 0.5,
                      Math.floor(i / width) + 0.5,
                    ),
                ),
              });
            } finally {
              assets.clear();
              native?.assets.clear();
              reopened?.assets.clear();
            }
          }
        // A paint layer without an asset has the same alpha-preserving policy,
        // including a protected first stroke on an entirely transparent source.
        const assets = new Assets(),
          doc = newDocument(7, 5),
          p = layer('paint', 'Brush', 7, 5);
        doc.bitsPerChannel = 32;
        doc.layers = [p];
        p.strokes = [
          {
            points: [[3.5, 2.5]],
            color: '#ff0000',
            size: 4,
            preserveAlpha: true,
          },
        ];
        await renderer.render(doc, assets);
        const empty = Array.from(
          (await renderer.rawSourcePixels(p, assets)).data,
        );
        p.strokes[0].preserveAlpha = false;
        await renderer.render(doc, assets);
        const before = Array.from(
          (await renderer.rawSourcePixels(p, assets)).data,
        );
        p.strokes.push({
          points: [[3.5, 2.5]],
          color: '#00ff00',
          size: 9,
          preserveAlpha: true,
        });
        await renderer.render(doc, assets);
        const after = Array.from(
          (await renderer.rawSourcePixels(p, assets)).data,
        );
        results.push({ empty, before, after });
        assets.clear();
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return results;
    }, profile);
    for (const r of results) {
      if ('empty' in r) {
        expect(r.empty.every((n) => n === 0)).toBe(true);
        for (let i = 0; i < r.after.length; i += 4) {
          expect(r.after[i + 3]).toBe(r.before[i + 3]);
          if (r.before[i + 3] > 0) {
            expect(r.after[i]).toBe(0);
            expect(r.after[i + 1]).toBe(1);
          }
        }
        continue;
      }
      expect(r.source).toEqual(r.nativeSource);
      expect(r.source).toEqual(r.unchanged);
      expect(r.sourceAfterMask).toEqual(r.source);
      const scale = r.depth === 8 ? 255 : r.depth === 16 ? 65535 : 1;
      for (let i = 0; i < r.data.length; i += 4) {
        const a = r.data[i + 3] / scale,
          s = r.coverage[i / 4];
        for (let ch = 0; ch < 3; ch++) {
          const original = r.data[i + ch] / scale;
          const code = r.stampData[i + ch] / 255;
          const color = r.linear
            ? code <= 0.04045
              ? code / 12.92
              : Math.pow((code + 0.055) / 1.055, 2.4)
            : code;
          const expected =
            a === 0 || s === 0 ? original : original * (1 - s) + color * s;
          expect(
            Math.abs(r.source[i + ch] / (r.depth === 8 ? 255 : 1) - expected),
            `${r.backend} RGB/${r.depth}, pixel ${i / 4}, channel ${ch}`,
          ).toBeLessThanOrEqual(r.depth === 8 ? 1 / 255 + 1e-7 : 4e-5);
        }
        expect(r.source[i + 3] / (r.depth === 8 ? 255 : 1)).toBeCloseTo(a, 7);
        if (r.depth === 32)
          expect(Object.is(r.source[i + 3], r.data[i + 3])).toBe(true);
        expect(
          Math.abs(r.reopenedSource[i + 3] / (r.depth === 8 ? 255 : 1) - a),
        ).toBeLessThan(1e-7);
        expect(r.hits[i / 4]).toBe(a >= 0.01);
        const mask = (i / 4) % r.width < Math.ceil(r.width / 2) ? 1 : 0;
        expect(
          Math.abs(
            r.masked[i + 3] / (r.depth === 8 ? 255 : 1) - a * 0.7 * 0.6 * mask,
          ),
        ).toBeLessThanOrEqual(r.depth === 8 ? 2 / 255 : 1e-7);
        for (let ch = 0; ch < 4; ch++)
          expect(
            Math.abs(r.reopenedSource[i + ch] - r.source[i + ch]),
          ).toBeLessThanOrEqual(
            r.depth === 16 ? 1 / 65535 : r.depth === 8 ? 1 : 1e-7,
          );
        if (s > 0 && a === 0) expect(r.unlocked[i + 3]).toBeGreaterThan(0);
      }
    }
  });
}

test('partial lock controls restrict only their operations and preserve captured strokes through undo', async ({
  page,
}) => {
  const bytes = await page.evaluate(async () => {
    const { layer, newDocument } = await import('/src/model/document.ts');
    const { serialize } = await import('/src/model/serialization.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const doc = newDocument(256, 192, 'Protection controls'),
      paint = layer('paint', 'Paint', 256, 192);
    paint.strokes = [{ points: [[128, 96]], size: 60, color: '#ff0000' }];
    paint.protection = { transparency: true, composite: false, position: true };
    doc.layers = [paint];
    const assets = new Assets();
    try {
      return Array.from(
        new Uint8Array(await (await serialize(doc, assets)).arrayBuffer()),
      );
    } finally {
      assets.clear();
    }
  });
  await openFiles(page, {
    name: 'locks.photo',
    mimeType: 'application/x-photo-editor',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('#layers .layer-row')).toHaveCount(1);
  const props = await panel(page, 'Properties');
  const box = (name: string) => props.getByRole('checkbox', { name, exact: true });
  const x = props.getByRole('spinbutton', { name: 'X', exact: true });
  await expect(box('Lock layer')).not.toBeChecked();
  await expect(box('Lock transparency')).toBeChecked();
  await expect(box('Lock position')).toBeChecked();
  await expect(x).toBeDisabled();
  await expect(page.locator('#opacity')).toBeEnabled();
  await expect(props.getByRole('slider', { name: 'brightness', exact: true })).toBeEnabled();
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  await idle(page);
  await expect(x).toHaveValue('0');
  await box('Lock position').uncheck();
  await idle(page);
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  await idle(page);
  await expect(x).toHaveValue('1');
  await undo(page);
  await expect(x).toHaveValue('0');

  // A coverage sample outside the red disc but inside the enlarged brush.
  const before = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { layerRGBA } = await import('/src/features/pixels.ts');
    const img = await layerRGBA(e, e.layer!);
    return img.data[(96 * img.width + 163) * 4 + 3];
  });
  await tool(page, 'Brush Tool');
  await page.locator('#viewport').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press(']');
  // Painting now rasterizes the legacy stroke layer into pixels; with
  // transparency locked the black paint keeps the existing alpha (the old
  // workspace recorded an alpha-preserving vector stroke instead).
  await canvasClick(page, 128, 96);
  await expect.poll(() => page.evaluate(() => window.photoStudio.history.labels.at(-1))).toBe('Brush Tool');
  expect(await page.evaluate(() => window.photoStudio.layer!.kind)).toBe('pixel');
  const center = await layerPixel(page, 128, 96);
  expect(center[3]).toBe(255);
  expect(Math.max(center[0], center[1], center[2])).toBeLessThan(40);
  expect((await layerPixel(page, 163, 96))[3]).toBe(before);
  await box('Lock transparency').uncheck();
  await idle(page);
  await box('Lock image pixels').check();
  await idle(page);
  const labels = await page.evaluate(() => window.photoStudio.history.labels.length);
  await canvasClick(page, 128, 96);
  await expect(page.locator('#toast')).toContainText('Unlock image pixels');
  expect(await page.evaluate(() => window.photoStudio.history.labels.length)).toBe(labels);
  // Pixel painting protection does not lock the layer's mask.
  await menu(page, 'Layer', 'Layer Mask', 'Reveal All');
  await canvasClick(page, 128, 96);
  await expect.poll(() => page.evaluate(() => window.photoStudio.history.labels.at(-1))).toBe('Brush Tool');
  const { bytes: saved } = await downloadFrom(page, () => menu(page, 'File', 'Download Project (.photo)'));
  const result = await page.evaluate(async (bytes) => {
    const { deserialize } = await import('/src/model/serialization.ts');
    const { readMask } = await import('/src/model/tiles.ts');
    const loaded = await deserialize(new Blob([new Uint8Array(bytes)]));
    try {
      const l = loaded.document.layers[0];
      return {
        kind: l.kind,
        protection: l.protection,
        mask: l.maskGrid && readMask(loaded.assets.tiles, l.maskGrid, { x: 128, y: 96, width: 1, height: 1 }).data[0],
        edge: l.maskGrid && readMask(loaded.assets.tiles, l.maskGrid, { x: 5, y: 5, width: 1, height: 1 }).data[0],
      };
    } finally {
      loaded.assets.clear();
    }
  }, Array.from(saved));
  expect(result.kind).toBe('pixel');
  expect(result.protection).toEqual({
    transparency: false,
    composite: true,
    position: false,
  });
  expect(result.mask).toBeLessThan(40);
  expect(result.edge).toBe(255);
});

test('active protected strokes reuse completed painting and match a cold render after undo or editing', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer/renderer.ts');
    const { ImageEngine } = await import('/src/engine/engine.ts');
    const { layer, newDocument } = await import('/src/model/document.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const results = [];
    for (const webgl of [false, true]) {
      if (webgl)
        Object.defineProperty(navigator, 'gpu', {
          value: undefined,
          configurable: true,
        });
      const engine = new ImageEngine(),
        assets = new Assets(),
        renderer = await Renderer.create(
          document.createElement('canvas'),
          engine,
        );
      const raster = engine.raster.bind(engine);
      let calls = 0;
      engine.raster = (...args) => {
        calls++;
        return raster(...args);
      };
      try {
        const doc = newDocument(31, 23),
          p = layer('paint', 'Brush', 31, 23);
        doc.bitsPerChannel = 32;
        doc.layers = [p];
        p.strokes = [{ points: [[15.5, 11.5]], size: 20.5, color: '#31579b' }];
        await renderer.render(doc, assets);
        for (let i = 0; i < 24; i++) {
          p.strokes.push({
            points: [[i + 0.25, 9.5]],
            size: 7.25,
            color: '#804020',
            preserveAlpha: true,
          });
          await renderer.render(doc, assets);
          p.strokes.at(-1)!.points.push([i + 1.125, 12.5]);
          await renderer.render(doc, assets);
        }
        const activeCalls = calls;
        const compare = async () => {
          const warm = Array.from(
            (await renderer.rawSourcePixels(p, assets)).data,
          );
          const cold = structuredClone(doc);
          cold.layers[0].id = crypto.randomUUID();
          await renderer.render(cold, assets);
          const pixels = Array.from(
            (await renderer.rawSourcePixels(cold.layers[0], assets)).data,
          );
          await renderer.render(doc, assets);
          return warm.every((v, i) => v === pixels[i]);
        };
        const initial = await compare();
        p.strokes.pop();
        await renderer.render(doc, assets);
        const undo = await compare();
        p.strokes[1].points[0][1] = 14.125;
        await renderer.render(doc, assets);
        const edited = await compare();
        // A transient worker failure must leave borrowed cached textures valid.
        p.strokes.at(-1)!.points.push([22, 14]);
        engine.raster = () =>
          Promise.reject(new Error('Transient brush failure'));
        let rejected = false;
        try {
          await renderer.render(doc, assets);
        } catch {
          rejected = true;
        }
        engine.raster = raster;
        await renderer.render(doc, assets);
        const recovered = await compare();
        results.push({
          backend: renderer.name,
          activeCalls,
          initial,
          undo,
          edited,
          rejected,
          recovered,
        });
      } finally {
        renderer.dispose();
        engine.dispose();
        assets.clear();
      }
    }
    return results;
  });
  for (const r of results) {
    expect(r.activeCalls).toBe(49);
    expect(r.initial).toBe(true);
    expect(r.undo).toBe(true);
    expect(r.edited).toBe(true);
    expect(r.rejected).toBe(true);
    expect(r.recovered).toBe(true);
  }
});

test('ordinary and protected brush strokes blend in document space without quantizing high-depth coverage', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer/renderer.ts');
    const { ImageEngine } = await import('/src/engine/engine.ts');
    const { layer, newDocument } = await import('/src/model/document.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const results = [];
    for (const webgl of [false, true]) {
      if (webgl)
        Object.defineProperty(navigator, 'gpu', {
          value: undefined,
          configurable: true,
        });
      const engine = new ImageEngine(),
        assets = new Assets(),
        renderer = await Renderer.create(
          document.createElement('canvas'),
          engine,
        );
      try {
        for (const depth of [16, 32] as const) {
          const doc = newDocument(13, 9),
            p = layer('paint', 'Brush', 13, 9);
          doc.bitsPerChannel = depth;
          doc.layers = [p];
          p.strokes = [
            { points: [[5.5, 4.25]], size: 8.25, color: '#ff0000' },
            { points: [[8.125, 4.5]], size: 7.5, color: '#0000ff' },
          ];
          const coverage = [];
          const canvas = document.createElement('canvas');
          canvas.width = 13;
          canvas.height = 9;
          const c = canvas.getContext('2d')!;
          for (const stroke of p.strokes) {
            const bitmap = await engine.raster(
              { ...p, strokes: [stroke] },
              13,
              9,
            );
            c.clearRect(0, 0, 13, 9);
            c.drawImage(bitmap, 0, 0);
            bitmap.close();
            coverage.push(
              Array.from(c.getImageData(0, 0, 13, 9).data)
                .filter((_, i) => i % 4 === 3)
                .map((a) => a / 255),
            );
          }
          await renderer.render(doc, assets);
          const ordinary = Array.from(
            (await renderer.rawSourcePixels(p, assets)).data,
          );
          p.strokes.push({
            points: [[6.5, 4.5]],
            size: 30,
            color: '#804020',
            preserveAlpha: true,
          });
          await renderer.render(doc, assets);
          const protectedPixels = Array.from(
            (await renderer.rawSourcePixels(p, assets)).data,
          );
          results.push({
            backend: renderer.name,
            depth,
            coverage,
            ordinary,
            protectedPixels,
          });
        }
      } finally {
        renderer.dispose();
        engine.dispose();
        assets.clear();
      }
    }
    return results;
  });
  const linear = (n: number) =>
    n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  for (const r of results)
    for (let i = 0; i < 13 * 9; i++) {
      const a = r.coverage[0][i],
        b = r.coverage[1][i],
        alpha = b + a * (1 - b);
      const rgb =
        alpha === 0 ? [0, 0, 0] : [(a * (1 - b)) / alpha, 0, b / alpha];
      for (let ch = 0; ch < 3; ch++) {
        expect(r.ordinary[i * 4 + ch]).toBeCloseTo(rgb[ch], 6);
        const brush = [128, 64, 32][ch] / 255;
        expect(r.protectedPixels[i * 4 + ch]).toBeCloseTo(
          alpha === 0 ? 0 : r.depth === 32 ? linear(brush) : brush,
          4,
        );
      }
      // UNORM8-to-float conversion and source-over arithmetic may differ
      // from the double-precision reference by a few float32 ULPs.
      expect(r.ordinary[i * 4 + 3]).toBeCloseTo(alpha, 6);
      expect(r.protectedPixels[i * 4 + 3]).toBe(r.ordinary[i * 4 + 3]);
    }
});
