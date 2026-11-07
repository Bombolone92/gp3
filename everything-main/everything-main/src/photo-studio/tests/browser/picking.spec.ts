import { test, expect, type Page } from '@playwright/test';
import { boot, idle, openFiles, panel, undo } from './helpers';

const spin = (page: Page, name: string) => page.locator('#properties').getByRole('spinbutton', { name, exact: true });
const option = (page: Page, name: string) => page.locator('#tool-options').getByRole('button', { name, exact: true });
const selectedRows = (page: Page) => page.locator('#layers .layer-row.selected');
// Transform of layer A in the first open document (the fixture).
const fixtureX = (page: Page) => page.evaluate(() => window.photoStudio.sessions[0].doc.layers.find((l) => l.name === 'A')!.transform.x);

test.beforeEach(async ({ page }) => {
  await boot(page, 'default', 'window.puter={};');
});

for (const backend of ['default', 'WebGL']) {
  test(`picking reuses rendered source coverage, transforms, masks and opacity (${backend})`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const result = await page.evaluate(async (webgl) => {
      if (webgl) Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
      const { Renderer } = await import('/src/renderer/renderer.ts');
      const { ImageEngine } = await import('/src/engine/engine.ts');
      const { Assets } = await import('/src/model/assets.ts');
      const { layer, newDocument } = await import('/src/model/document.ts');
      const { hitLayer } = await import('/src/ui/hit-test.ts');
      const engine = new ImageEngine(),
        assets = new Assets();
      const renderer = await Renderer.create(document.createElement('canvas'), engine);
      const failures: unknown[] = [];
      let samples = 0,
        rasterCalls = 0,
        oversizedReads = 0;
      const raster = engine.raster.bind(engine);
      engine.raster = (...args) => {
        rasterCalls++;
        return raster(...args);
      };
      try {
        for (const depth of [8, 16, 32] as const) {
          for (const scenario of ['brush', 'text', 'transformed', 'nested', 'native'] as const) {
            const w = scenario === 'brush' ? 13 : 19,
              h = scenario === 'brush' ? 9 : 15;
            const doc = newDocument(w, h),
              leaf = layer(scenario === 'text' ? 'text' : 'paint', scenario, w, h);
            doc.bitsPerChannel = depth;
            leaf.text = 'Ag';
            leaf.fontSize = 9;
            leaf.strokes =
              scenario === 'text'
                ? []
                : [
                    { points: [[w * 0.42, h * 0.47]], size: w * 0.63, color: '#ff0000' },
                    {
                      points: [
                        [w * 0.61, h * 0.5],
                        [w * 0.74, h * 0.7],
                      ],
                      size: w * 0.37,
                      color: '#0066ff',
                    },
                    {
                      points: [[w * 0.31, h * 0.4]],
                      size: w * 0.51,
                      color: '#44cc66',
                      preserveAlpha: true,
                    },
                  ];
            if (scenario === 'native') {
              const data = depth === 16 ? new Uint16Array(w * h * 4) : new Float32Array(w * h * 4);
              for (let i = 0; i < w * h; i++) {
                const alpha = (i % 9) / 8;
                data.set(
                  depth === 16
                    ? [1234, 43210, 9876, Math.round(alpha * 65535)]
                    : [0.12, 0.78, 0.23, alpha],
                  i * 4,
                );
              }
              leaf.asset = await assets.addRaster({ width: w, height: h, data });
              leaf.assetColorSpace = 'document';
              leaf.strokes = [leaf.strokes.at(-1)!];
              leaf.opacity = 0.38;
              leaf.transform.x = 0.25;
              leaf.transform.y = -0.375;
            }
            let parents: (typeof leaf)[] = [];
            if (scenario === 'transformed') {
              leaf.transform = {
                x: -1.25,
                y: 1.125,
                width: w * 0.91,
                height: h * 1.13,
                rotation: 17,
              };
              leaf.opacity = 0.47;
              leaf.filters.blur = 0.7;
              leaf.mask = { x: 1.75, y: 1.5, width: w - 3, height: h - 2.25 };
            }
            if (scenario === 'nested') {
              const inner = layer('group', 'inner', w, h),
                outer = layer('group', 'outer', w, h);
              inner.opacity = 0.73;
              outer.opacity = 0.41;
              inner.mask = { x: 2.5, y: 1.25, width: w - 4, height: h - 3 };
              outer.maskStrokes = [
                {
                  points: [[w * 0.5, h * 0.5]],
                  size: w * 0.4,
                  softness: 0.4,
                  opacity: 0.8,
                  restore: false,
                },
              ];
              inner.children = [leaf];
              outer.children = [inner];
              doc.layers = [outer];
              parents = [outer, inner];
            } else doc.layers = [leaf];
            await renderer.render(doc, assets);
            const pixels = await renderer.rawPixels(),
              floating = pixels instanceof Float32Array;
            const callsBefore = rasterCalls;
            const gpu = (renderer as any).backend;
            const read = gpu.read.bind(gpu),
              readFloat = gpu.readFloat.bind(gpu);
            gpu.read = (t: { width: number; height: number }) => {
              if (t.width !== 1 || t.height !== 1) oversizedReads++;
              return read(t);
            };
            gpu.readFloat = (t: { width: number; height: number }) => {
              if (t.width !== 1 || t.height !== 1) oversizedReads++;
              return readFloat(t);
            };
            try {
              for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++) {
                  if (scenario !== 'brush' && (x + y * w) % 7 !== 0) continue;
                  const expected = pixels[(y * w + x) * 4 + 3] / (floating ? 1 : 255);
                  const actual = await renderer.pickCoverage(
                    doc,
                    assets,
                    leaf,
                    parents,
                    x + 0.125,
                    y + 0.875,
                  );
                  const picked = await hitLayer(doc, assets, x + 0.125, y + 0.875, (l, p, px, py) =>
                    renderer.pickCoverage(doc, assets, l, p, px, py),
                  );
                  if (
                    Math.abs(actual - expected) > (floating ? 0.000001 : 1 / 255) ||
                    !!picked !== expected >= 0.01
                  )
                    failures.push({ depth, scenario, x, y, expected, actual, picked: !!picked });
                  samples++;
                }
            } finally {
              gpu.read = read;
              gpu.readFloat = readFloat;
            }
            if (rasterCalls !== callsBefore)
              failures.push({ scenario, uncachedRasterCalls: rasterCalls - callsBefore });
            // Viewport uniforms must not leak into the next ordinary frame.
            await renderer.render(doc, assets);
            const normal = await renderer.rawPixels();
            if (!normal.every((v, i) => v === pixels[i]))
              failures.push({ depth, scenario, changedNormalFrame: true });
          }
        }
        return { backend: renderer.name, failures: failures.slice(0, 20), samples, oversizedReads };
      } finally {
        renderer.dispose();
        engine.dispose();
        assets.clear();
      }
    }, backend === 'WebGL');
    expect(result.failures).toEqual([]);
    expect(result.samples).toBeGreaterThan(500);
    expect(result.oversizedReads).toBe(0);
    if (backend === 'WebGL') expect(result.backend).toBe('WebGL2');
  });
}

async function fixture(page: Page) {
  const bytes = await page.evaluate(async () => {
    const { serialize } = await import('/src/model/serialization.ts');
    const { layer, newDocument } = await import('/src/model/document.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const doc = newDocument(320, 180, 'Picking gestures'),
      a = layer('paint', 'A', 80, 80),
      b = layer('paint', 'B', 80, 80);
    a.transform.x = 20;
    a.transform.y = 40;
    b.transform.x = 180;
    b.transform.y = 40;
    for (const l of [a, b]) l.strokes = [{ points: [[40, 40]], size: 50, color: '#ffaa00' }];
    doc.layers = [a, b];
    return Array.from(new Uint8Array(await (await serialize(doc, new Assets())).arrayBuffer()));
  });
  await openFiles(page, {
    name: 'gestures.photo',
    mimeType: 'application/x-photo-editor',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('#document-name')).toHaveText('Picking gestures');
  await panel(page, 'Properties');
  // Begin with no selection; selected handles must not intercept the click.
  await page.evaluate(() =>
    document.querySelector('#viewport')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }),
    ),
  );
  await expect(selectedRows(page)).toHaveCount(0);
  await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer/renderer.ts');
    const original = Renderer.prototype.pickCoverage;
    (window as any).pickWaiters = [];
    // Start the real readback at once (as the app does, so document replacement
    // settles it) but hold its result until the test releases it. Deferring the
    // call itself would let a released stale pick redraw the old document on
    // the canvas after a replacement had already rendered.
    Renderer.prototype.pickCoverage = function (...args) {
      const result = Promise.resolve(original.apply(this, args));
      return new Promise<number>((resolve, reject) => {
        (window as any).pickWaiters.push(() => result.then(resolve, reject));
      });
    };
  });
}

test('document replacement waits for pending coverage source users, including failed reads', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer/renderer.ts');
    const { ImageEngine } = await import('/src/engine/engine.ts');
    const { Assets } = await import('/src/model/assets.ts');
    const { layer, newDocument } = await import('/src/model/document.ts');
    const engine = new ImageEngine(),
      assets = new Assets(),
      renderer = await Renderer.create(document.createElement('canvas'), engine);
    const doc = newDocument(7, 5),
      l = layer('paint', 'Source lease', 7, 5);
    l.strokes = [{ points: [[3, 2]], size: 4, color: '#4466aa' }];
    doc.layers = [l];
    const results = [];
    try {
      await renderer.render(doc, assets);
      const gpu = renderer.backend,
        read = gpu.read.bind(gpu);
      for (const fail of [false, true]) {
        let release!: () => void,
          notify!: () => void,
          settled = false;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          notify = resolve;
        });
        gpu.read = async (t) => {
          notify();
          await gate;
          if (fail) throw new Error('Read failed');
          return read(t);
        };
        const pick = Promise.resolve(renderer.pickCoverage(doc, assets, l, [], 3.5, 2.5)).then(
          (v) => v,
          () => 'rejected',
        );
        const settling = renderer.settle().then(() => {
          settled = true;
        });
        await started;
        const early = settled;
        release();
        const coverage = await pick;
        await settling;
        results.push({ early, settled, coverage });
        gpu.read = read;
      }
    } finally {
      renderer.dispose();
      engine.dispose();
      assets.clear();
    }
    return results;
  });
  expect(results).toEqual([
    { early: false, settled: true, coverage: 1 },
    { early: false, settled: true, coverage: 'rejected' },
  ]);
});
async function canvasPoint(page: Page, x: number, y: number) {
  const bounds = (await page.locator('#stage').boundingBox())!;
  return { x: bounds.x + (x * bounds.width) / 320, y: bounds.y + (y * bounds.height) / 180 };
}
async function release(page: Page) {
  await page.waitForFunction(() => (window as any).pickWaiters.length > 0);
  await page.evaluate(() => (window as any).pickWaiters.shift()());
}

test('a drag released before coverage arrives commits its final movement once', async ({
  page,
}) => {
  await fixture(page);
  const start = await canvasPoint(page, 60, 80),
    end = await canvasPoint(page, 83, 97);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await release(page);
  await expect(spin(page, 'X')).toHaveValue('43');
  await expect(spin(page, 'Y')).toHaveValue('57');
  await undo(page);
  await expect(spin(page, 'X')).toHaveValue('20');
});

test('quick additive clicks retain their order while coverage is pending', async ({ page }) => {
  await fixture(page);
  const a = await canvasPoint(page, 60, 80),
    b = await canvasPoint(page, 220, 80);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await release(page);
  await expect(selectedRows(page)).toHaveCount(1);
  await release(page);
  await expect(selectedRows(page)).toHaveCount(2);
});

test('cancelled coverage does not delay a subsequent transform handle', async ({ page }) => {
  await fixture(page);
  const start = await canvasPoint(page, 60, 80);
  await page.mouse.click(start.x, start.y);
  await page.keyboard.press('Escape');
  await page.locator('#layers .layer-row').filter({ has: page.getByRole('button', { name: 'A', exact: true }) }).locator('.layer-name').click();
  const bounds = (await page.locator('.handle-se .handle-hit').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(option(page, 'Apply')).toBeVisible();
  await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 20);
  await page.mouse.up();
  await release(page);
  await expect(spin(page, 'W')).toHaveValue('100');
  await option(page, 'Cancel').click();
  await expect(spin(page, 'W')).toHaveValue('80');
});

for (const cancellation of ['Escape', 'tool', 'pointercancel', 'blur', 'replacement']) {
  test(`pending coverage cannot apply a stale gesture after ${cancellation}`, async ({ page }) => {
    await fixture(page);
    const start = await canvasPoint(page, 60, 80),
      end = await canvasPoint(page, 85, 99);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    if (cancellation === 'Escape') await page.keyboard.press('Escape');
    else if (cancellation === 'tool') await page.keyboard.press('b');
    else if (cancellation === 'pointercancel')
      await page.locator('#viewport').dispatchEvent('pointercancel', { pointerId: 1 });
    else if (cancellation === 'blur')
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else {
      await page.mouse.up();
      await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
      await page.locator('.menubar-entry.open .menu-item[data-command="file.new"]').click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Replacement');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.locator('#document-name')).toHaveText('Replacement');
    }
    await page.mouse.up();
    await release(page);
    // Drain asynchronous coverage through another frame before asserting.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await idle(page);
    // The stale drag never moves the fixture layer.
    expect(await fixtureX(page)).toBe(20);
    if (cancellation === 'replacement') {
      // File → New now opens a separate tab whose transparent document starts
      // with an empty, selected "Layer 1" (it used to replace the document with
      // a zero-layer canvas).
      await expect(page.locator('.document-tab')).toHaveCount(2);
      await expect(page.locator('#layer-count')).toHaveText('1');
      await expect(selectedRows(page)).toHaveCount(1);
      await expect(page.locator('#canvas')).toHaveAttribute('width', '1600');
      await expect(page.locator('#canvas')).toHaveAttribute('height', '1000');
    } else await expect(selectedRows(page)).toHaveCount(0);
  });
}
