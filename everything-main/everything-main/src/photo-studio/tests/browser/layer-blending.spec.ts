import { expect, test, type Page } from '@playwright/test';
import { boot, idle, menu, openImage, run, start } from './helpers';

// Blend If, excluded channels, knockout and clipping options rendered by both
// compositor backends, compared with the reference math in model/blending.

type Spec = { kind: 'ramp' | 'solid'; color?: [number, number, number]; blending?: unknown; fillOpacity?: number; background?: boolean; rect?: [number, number, number, number]; clipped?: boolean; blend?: string };

/** Replaces the document's layers (bottom first) and returns composite pixels. */
async function composite(page: Page, specs: Spec[]) {
  await page.evaluate(async (specs) => {
    const e = window.photoStudio;
    const { layer } = await import('/src/model/document.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const { setLayerPixels } = await import('/src/model/pixel-layer.ts');
    const w = e.doc.width, h = e.doc.height;
    const layers = specs.map((s, n) => {
      const l = layer('pixel', `L${n}`, w, h);
      const [x0, y0, rw, rh] = s.rect ?? [0, 0, w, h];
      const data = new Uint8ClampedArray(rw * rh * 4);
      for (let y = 0; y < rh; y++)
        for (let x = 0; x < rw; x++) {
          const v = s.kind === 'ramp' ? x0 + x : 0;
          data.set(s.kind === 'ramp' ? [v, v, v, 255] : [...s.color!, 255], (y * rw + x) * 4);
        }
      setLayerPixels(l, gridFromImage(e.assets.tiles, { width: rw, height: rh, data }, x0, y0), e.doc);
      if (s.blending) l.blending = s.blending as never;
      if (s.fillOpacity !== undefined) l.fillOpacity = s.fillOpacity;
      if (s.background) l.background = true;
      if (s.clipped) l.clipped = true;
      if (s.blend) l.blend = s.blend as never;
      return l;
    });
    e.command('Test Layers', (d) => {
      d.layers = layers;
    });
  }, specs);
  await idle(page);
  return page.evaluate(async () => {
    const e = window.photoStudio;
    return Array.from(await e.renderer.documentPixels(e.doc, e.assets));
  });
}
const at = (px: number[], width: number, x: number, y = 2) => px.slice((y * width + x) * 4, (y * width + x) * 4 + 4);
// Reference weight (model/blending.ts rangeWeight).
const weight = (v: number, r: number[]) => {
  const lo = r[1] > r[0] ? Math.min(1, Math.max(0, (v - r[0]) / (r[1] - r[0]))) : v >= r[0] ? 1 : 0;
  const hi = r[3] > r[2] ? Math.min(1, Math.max(0, (r[3] - v) / (r[3] - r[2]))) : v <= r[3] ? 1 : 0;
  return lo * hi;
};

for (const backend of ['WebGPU', 'WebGL'] as const) {
  test.describe(`advanced blending (${backend})`, () => {
    test.beforeEach(async ({ page }) => {
      await boot(page, backend);
      await openImage(page, 256, 4, '#000000', 'blend.png');
    });

    test('Blend If ranges of this layer and the underlying layer', async ({ page }) => {
      const thisRange = [64, 128, 192, 255];
      let px = await composite(page, [
        { kind: 'solid', color: [0, 0, 255] },
        { kind: 'ramp', blending: { ranges: { gray: { this: thisRange, underlying: [0, 0, 255, 255] } } } },
      ]);
      for (const x of [0, 63, 64, 96, 128, 160, 192, 224, 255]) {
        const w = weight(x, thisRange);
        const expected = [x * w, x * w, x * w + 255 * (1 - w)];
        at(px, 256, x).slice(0, 3).forEach((v, i) => expect(Math.abs(v - expected[i]), `x=${x} c=${i}`).toBeLessThanOrEqual(2));
      }
      const under = [0, 0, 100, 150];
      px = await composite(page, [
        { kind: 'ramp' },
        { kind: 'solid', color: [255, 0, 0], blending: { ranges: { gray: { this: [0, 0, 255, 255], underlying: under } } } },
      ]);
      for (const x of [0, 50, 100, 125, 150, 200]) {
        const w = weight(x, under);
        const expected = [255 * w + x * (1 - w), x * (1 - w), x * (1 - w)];
        at(px, 256, x).slice(0, 3).forEach((v, i) => expect(Math.abs(v - expected[i]), `x=${x} c=${i}`).toBeLessThanOrEqual(2));
      }
      // A red-channel range combines with the gray range.
      px = await composite(page, [
        { kind: 'solid', color: [0, 0, 0] },
        { kind: 'ramp', blending: { ranges: { red: { this: [0, 0, 100, 100], underlying: [0, 0, 255, 255] }, gray: { this: [50, 50, 255, 255], underlying: [0, 0, 255, 255] } } } },
      ]);
      expect(at(px, 256, 40)[0]).toBeLessThanOrEqual(1);
      expect(at(px, 256, 80)[0]).toBe(80);
      expect(at(px, 256, 120)[0]).toBeLessThanOrEqual(1);
    });

    test('excluded channels keep the underlying values', async ({ page }) => {
      const px = await composite(page, [
        { kind: 'solid', color: [10, 20, 30] },
        { kind: 'solid', color: [250, 240, 230], blending: { exclude: { r: true, b: true } } },
      ]);
      expect(at(px, 256, 100)).toEqual([10, 240, 30, 255]);
    });

    test('deep and shallow knockouts reveal the background or the group start', async ({ page }) => {
      let px = await composite(page, [
        { kind: 'solid', color: [0, 255, 0], background: true },
        { kind: 'solid', color: [255, 0, 0] },
        { kind: 'solid', color: [0, 0, 255], rect: [100, 0, 50, 4], fillOpacity: 0, blending: { knockout: 'deep' } },
      ]);
      expect(at(px, 256, 120)).toEqual([0, 255, 0, 255]);
      expect(at(px, 256, 20)).toEqual([255, 0, 0, 255]);
      // Half fill: the layer itself shows over the revealed background.
      px = await composite(page, [
        { kind: 'solid', color: [0, 255, 0], background: true },
        { kind: 'solid', color: [255, 0, 0] },
        { kind: 'solid', color: [0, 0, 255], rect: [100, 0, 50, 4], fillOpacity: 0.5, blending: { knockout: 'deep' } },
      ]);
      at(px, 256, 120).forEach((v, i) => expect(Math.abs(v - [0, 128, 128, 255][i])).toBeLessThanOrEqual(2));
      // In a pass-through group a shallow knockout reveals what is under the group.
      await page.evaluate(async () => {
        const e = window.photoStudio;
        const { layer } = await import('/src/model/document.ts');
        e.command('Group', (d) => {
          const [bg, red, top] = d.layers;
          const g = layer('group', 'G', d.width, d.height);
          g.blend = 'pass through';
          red.blend = 'normal';
          top.blending = { knockout: 'shallow' };
          top.fillOpacity = 0;
          g.children = [red, top];
          bg.background = false;
          d.layers = [bg, g];
        });
      });
      await idle(page);
      px = await page.evaluate(async () => Array.from(await window.photoStudio.renderer.documentPixels(window.photoStudio.doc, window.photoStudio.assets)));
      expect(at(px, 256, 120)).toEqual([0, 255, 0, 255]);
      expect(at(px, 256, 20)).toEqual([255, 0, 0, 255]);
    });

    test('clipped layers can blend with the backdrop instead of their base', async ({ page }) => {
      const specs = (clippedAsGroup: boolean): Spec[] => [
        { kind: 'solid', color: [200, 100, 50] },
        { kind: 'solid', color: [255, 255, 255], rect: [0, 0, 128, 4], blend: 'multiply', blending: clippedAsGroup ? undefined : { clippedAsGroup: false } },
        { kind: 'solid', color: [128, 128, 128], clipped: true, blend: 'normal' },
      ];
      // As a group: gray over white, then multiplied with the backdrop.
      let px = await composite(page, specs(true));
      at(px, 256, 10).slice(0, 3).forEach((v, i) => expect(Math.abs(v - Math.round(([200, 100, 50][i] * 128) / 255))).toBeLessThanOrEqual(2));
      // Separately: the clipped gray covers the backdrop directly in the base's shape.
      px = await composite(page, specs(false));
      expect(at(px, 256, 10)).toEqual([128, 128, 128, 255]);
      expect(at(px, 256, 200)).toEqual([200, 100, 50, 255]);
    });
  });
}

test('Blending Options dialog edits Blend If with split handles', async ({ page }) => {
  await boot(page);
  await openImage(page, 256, 64, '#336699', 'dialog.png');
  await page.evaluate(() => window.photoStudio.runCommand('layer.from-background'));
  await idle(page);
  await start(page, 'layer.style-blending');
  const dialog = page.getByRole('dialog', { name: 'Layer Style' });
  await expect(dialog).toBeVisible();
  const handle = dialog.getByRole('slider', { name: 'Underlying Layer black, high' });
  const box = (await dialog.locator('.fx-range-track').nth(1).boundingBox())!;
  const from = (await handle.boundingBox())!;
  // Alt-drag splits the black pair: only the high half moves.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (60 / 255), from.y + 4, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(dialog.locator('.fx-range-row').nth(1).locator('[data-side=black]')).toHaveText(/^0 \/ (59|60|61)$/);
  await dialog.getByLabel('Knockout').selectOption('shallow');
  await dialog.getByRole('checkbox', { name: 'G', exact: true }).uncheck();
  await page.screenshot({ path: test.info().outputPath('blending-options.png') });
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await idle(page);
  const blending = await page.evaluate(() => window.photoStudio.layer?.blending);
  expect(blending?.knockout).toBe('shallow');
  expect(blending?.exclude).toEqual({ g: true });
  expect(blending?.ranges?.gray?.underlying[0]).toBe(0);
  expect(blending?.ranges?.gray?.underlying[1]).toBeGreaterThanOrEqual(59);
  // One undo step restores the plain layer.
  await run(page, 'edit.undo');
  expect(await page.evaluate(() => window.photoStudio.layer?.blending)).toBeUndefined();
});

test('Layer Style submenu: effect entries, global light and create layers', async ({ page }) => {
  await boot(page);
  await openImage(page, 120, 80, '#ffffff', 'fx.png');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { layer } = await import('/src/model/document.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const { setLayerPixels } = await import('/src/model/pixel-layer.ts');
    const l = layer('pixel', 'Shape', e.doc.width, e.doc.height);
    const data = new Uint8ClampedArray(40 * 30 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([40, 160, 220, 255], i);
    setLayerPixels(l, gridFromImage(e.assets.tiles, { width: 40, height: 30, data }, 40, 25), e.doc);
    e.command('Shape', (d) => {
      d.layers.push(l);
    });
    e.selectLayer(l.id);
  });
  await idle(page);
  // An effect entry opens the dialog on that effect and turns it on.
  await menu(page, 'Layer', 'Layer Style', 'Drop Shadow…');
  const dialog = page.getByRole('dialog', { name: 'Layer Style' });
  await expect(dialog.locator('.ls-title')).toHaveText('Drop Shadow');
  await dialog.locator('.ls-item.active input[type=checkbox]').isChecked().then((v) => expect(v).toBe(true));
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await idle(page);
  await run(page, 'layer.style-color-overlay');
  await page.getByRole('dialog', { name: 'Layer Style' }).getByRole('button', { name: 'OK', exact: true }).click();
  await idle(page);
  expect(await page.evaluate(() => Object.keys(window.photoStudio.layer?.style ?? {}).sort())).toEqual(['colorOverlay', 'dropShadow', 'enabled']);
  // The document light moves the shadow of every effect that uses it.
  await menu(page, 'Layer', 'Layer Style', 'Global Light…');
  const light = page.getByRole('dialog', { name: 'Global Light' });
  await light.getByRole('spinbutton', { name: 'Angle degrees' }).fill('-90');
  await light.getByRole('spinbutton', { name: 'Angle degrees' }).press('Enter');
  await page.screenshot({ path: test.info().outputPath('global-light.png') });
  await light.getByRole('button', { name: 'OK', exact: true }).click();
  await idle(page);
  expect(await page.evaluate(() => window.photoStudio.doc.globalLight?.angle)).toBe(-90);
  const before = await page.evaluate(async () => Array.from(await window.photoStudio.renderer.documentPixels(window.photoStudio.doc, window.photoStudio.assets)));
  // Light from below: the shadow falls above the shape.
  const pixel = (px: number[], x: number, y: number) => px.slice((y * 120 + x) * 4, (y * 120 + x) * 4 + 3);
  expect(pixel(before, 60, 22)[0]).toBeLessThan(250);
  expect(pixel(before, 60, 58)).toEqual([255, 255, 255]);
  // Create Layers splits the effects and keeps the look.
  await menu(page, 'Layer', 'Layer Style', 'Create Layers');
  await idle(page);
  const names = await page.evaluate(() => window.photoStudio.doc.layers.map((l) => [l.name, l.blend, !!l.clipped, !!l.style]));
  expect(names.slice(1)).toEqual([
    ['Shape’s Drop Shadow', 'multiply', false, false],
    ['Shape', 'normal', false, false],
    ['Shape’s Color Overlay', 'normal', true, false],
  ]);
  const after = await page.evaluate(async () => Array.from(await window.photoStudio.renderer.documentPixels(window.photoStudio.doc, window.photoStudio.assets)));
  let worst = 0;
  for (let i = 0; i < after.length; i++) worst = Math.max(worst, Math.abs(after[i] - before[i]));
  expect(worst).toBeLessThanOrEqual(3);
});

test('Layer Content Options reopens fill and adjustment settings', async ({ page }) => {
  await boot(page);
  await openImage(page, 64, 64, '#808080', 'content.png');
  await run(page, 'layer.adj-levels');
  // Record which panel the command brings forward.
  await page.evaluate(() => {
    const dock = window.photoStudio.dock!;
    const show = dock.show.bind(dock);
    (window as unknown as { shown: string[] }).shown = [];
    dock.show = (id: string, toggle?: boolean) => {
      (window as unknown as { shown: string[] }).shown.push(id);
      return show(id, toggle);
    };
  });
  await menu(page, 'Layer', 'Layer Content Options…');
  expect(await page.evaluate(() => (window as unknown as { shown: string[] }).shown)).toEqual(['properties']);
  await expect(page.locator('[data-panel="properties"]')).toBeVisible();
  // Without a fill or adjustment layer the entry is unavailable.
  await page.evaluate(() => window.photoStudio.selectLayer(window.photoStudio.doc.layers[0].id));
  expect(await page.evaluate(async () => (await import('/src/app/registry.ts')).commands.get('layer.content-options')!.enabled!(window.photoStudio))).toBe(false);
});

test('PSD Blend If ranges, channel restrictions and knockout open as editable options', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { writePsd } = await import('/tests/browser/psd-codec.ts');
    const { openPsd } = await import('/src/model/psd.ts');
    const imageData = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) };
    const blob = new Blob([
      writePsd({
        width: 2,
        height: 1,
        imageData,
        children: [{
          name: 'Ranged', imageData, knockout: true, blendInteriorElements: true,
          channelBlendingRestrictions: [1, 1],
          blendingRanges: {
            compositeGrayBlendSource: [0, 0, 255, 255],
            compositeGraphBlendDestinationRange: [10, 40, 255, 255],
            ranges: [{ sourceRange: [0, 0, 255, 255], destRange: [0, 0, 255, 255] }, { sourceRange: [0, 0, 200, 220], destRange: [0, 0, 255, 255] }, { sourceRange: [0, 0, 255, 255], destRange: [0, 0, 255, 255] }],
          },
        }],
      }),
    ]);
    const loaded = await openPsd(blob, 'Ranged.psd', window.photoStudio.engine);
    const l = loaded.document.layers[0];
    loaded.assets.clear();
    return { notice: loaded.notice ?? '', name: l.name, blending: l.blending };
  });
  expect(result.notice).not.toContain('saved composite');
  expect(result.name).toBe('Ranged');
  expect(result.blending).toEqual({
    ranges: { gray: { this: [0, 0, 255, 255], underlying: [10, 40, 255, 255] }, green: { this: [0, 0, 200, 220], underlying: [0, 0, 255, 255] } },
    exclude: { g: true },
    knockout: 'shallow',
    interiorAsGroup: true,
  });
});
