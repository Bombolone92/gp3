// Features that were built separately, used together on one document: mode
// conversions, saving and reopening, duplicating and history.
import { expect, test, type Page } from '@playwright/test';
import { boot, canvasClick, idle, openImage, run, start, tool } from './helpers';
import { documentDigest, kitchenSink } from './kitchen-sink';

/** Composite pixels whose channels differ by more than a few levels. */
const colorfulPixels = (page: Page) =>
  page.evaluate(async () => {
    const e = window.photoStudio;
    await e.renderer.settle();
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    const img = await compositeRGBA(e);
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i + 3] && Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) - Math.min(img.data[i], img.data[i + 1], img.data[i + 2]) > 6) n++;
    return n;
  });

/** Save to .photo in memory and open the result as a new document. */
async function reopen(page: Page) {
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize } = await import('/src/model/serialization.ts');
    const { openFile } = await import('/src/features/files/open.ts');
    const blob = await serialize(e.doc, e.assets);
    await openFile(e, new File([blob], 'reopened.photo'), 'reopened.photo');
  });
  await idle(page);
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('Grayscale converts type runs, Live Filter sources and artboard colors too', async ({ page }) => {
  await openImage(page, 200, 120, '#3070c0');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { createArtboard } = await import('/src/model/artboard.ts');
    e.command('Artboard', (d) => void d.layers.push(createArtboard(d, { x: 100, y: 80, width: 40, height: 30 }, { background: 'custom', color: '#20c040' })));
  });
  await page.evaluate(() => window.photoStudio.setForeground('#e02020'));
  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 20, 60);
  await page.keyboard.type('Red');
  await page.keyboard.press('Escape');
  await idle(page);
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const data = new Uint8ClampedArray(40 * 40 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([20, 200, 40, 255], i);
    const l = newPixelLayer('Green', e.doc, gridFromImage(e.assets.tiles, { width: 40, height: 40, data }, 140, 10));
    e.command('Green', (d) => d.layers.push(l));
    e.selectLayers([l.id]);
  });
  await run(page, 'filter.convert-live');
  await run(page, 'filter.apply.gaussian-blur', { params: { radius: 1 } });
  expect(await colorfulPixels(page)).toBeGreaterThan(1000);
  await page.evaluate(async () => {
    const { convertToMode } = await import('/src/features/color/modes.ts');
    await convertToMode(window.photoStudio, 'grayscale');
  });
  await idle(page);
  expect(await colorfulPixels(page)).toBe(0);
  // Re-rendering the Live Filters starts from the converted source.
  await run(page, 'layer.live-toggle-all');
  await run(page, 'layer.live-toggle-all');
  expect(await colorfulPixels(page)).toBe(0);
  const run0 = await page.evaluate(() => window.photoStudio.doc.layers.find((l) => l.kind === 'text')!.textData!.content.paragraphs[0].runs[0].style.color);
  expect(new Set(run0).size).toBe(1);
});

test('a document using many features saves and reopens unchanged', async ({ page }) => {
  await kitchenSink(page);
  const before = await documentDigest(page);
  await reopen(page);
  const after = await documentDigest(page);
  // The active selection is session state; everything else is kept.
  delete before.selectionMask;
  delete after.selectionMask;
  expect(after).toEqual(before);
});

test('type rasterized by Flip Canvas or Rasterize Layer Style still saves', async ({ page }) => {
  await openImage(page, 200, 120, '#ffffff');
  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 20, 60);
  await page.keyboard.type('Flip');
  await page.keyboard.press('Escape');
  await idle(page);
  await run(page, 'image.flip-horizontal');
  expect(await page.evaluate(() => window.photoStudio.doc.layers.map((l) => l.kind))).toEqual(['pixel', 'pixel']);
  await reopen(page);
  expect(await page.evaluate(() => window.photoStudio.session.fileName)).toBe('reopened.photo');

  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 20, 100);
  await page.keyboard.type('Style');
  await page.keyboard.press('Escape');
  await idle(page);
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { defaultDropShadow } = await import('/src/imaging/effects/types.ts');
    e.editLayer('Layer Style', (l) => void (l.style = { dropShadow: [defaultDropShadow()] }));
  });
  await idle(page);
  await run(page, 'layer.rasterize-style');
  expect(await page.evaluate(() => window.photoStudio.layer!.kind)).toBe('pixel');
  await reopen(page);
  expect(await page.evaluate(() => window.photoStudio.doc.layers.length)).toBe(3);
});

test('Toggle Last State flips between the last two states', async ({ page }) => {
  await openImage(page, 100, 80, '#ffffff');
  for (const x of [10, 20, 30])
    await page.evaluate((x) => {
      const e = window.photoStudio;
      e.command(`Guide ${x}`, (d) => void (d.guides = [...(d.guides ?? []), { orientation: 'vertical', position: x }]));
    }, x);
  await idle(page);
  const guides = () => page.evaluate(() => window.photoStudio.doc.guides?.map((g) => g.position));
  await run(page, 'edit.toggle-last-state');
  expect(await guides()).toEqual([10, 20]);
  await run(page, 'edit.toggle-last-state');
  expect(await guides()).toEqual([10, 20, 30]);
  await run(page, 'edit.toggle-last-state');
  expect(await guides()).toEqual([10, 20]);
  // An ordinary undo first: toggling then steps back from there.
  await run(page, 'edit.undo');
  await run(page, 'edit.toggle-last-state');
  expect(await guides()).toEqual(undefined);
  await run(page, 'edit.toggle-last-state');
  expect(await guides()).toEqual([10]);
});

test('readbacks right after flipping an embedded object show it flipped', async ({ page }) => {
  await openImage(page, 240, 160, '#ffffff');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const data = new Uint8ClampedArray(60 * 40 * 4);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) data.set([x * 4, 100, 200, 255], (y * 60 + x) * 4);
    const object = newPixelLayer('Object', e.doc, gridFromImage(e.assets.tiles, { width: 60, height: 40, data }, 100, 40));
    e.command('Object', (d) => d.layers.push(object));
    e.selectLayers([object.id]);
  });
  await idle(page);
  await run(page, 'layer.embed-convert');
  // As an action plays: the next step reads pixels as soon as the flip returns.
  const red = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { compositeRGBA, layerRGBA } = await import('/src/features/pixels.ts');
    await e.runCommand('edit.flip-horizontal');
    const doc = (await compositeRGBA(e)).data[(50 * 240 + 101) * 4];
    const layer = (await layerRGBA(e, e.layer!)).data[(50 * 240 + 101) * 4];
    return [doc, layer];
  });
  expect(red[0]).toBeGreaterThan(200);
  expect(red[1]).toBeGreaterThan(200);
});

test('variable names of deleted layers can be used again', async ({ page }) => {
  await openImage(page, 120, 80, '#ffffff');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const gone = newPixelLayer('Gone', e.doc);
    e.command('Layers', (d) => {
      d.layers.push(gone);
      d.variables = { layers: { [gone.id]: { visibility: 'shown' } }, sets: [] };
    });
    e.command('Delete', (d) => void (d.layers = d.layers.filter((l) => l.id !== gone.id)));
    e.selectLayers([e.doc.layers[0].id]);
  });
  await idle(page);
  await start(page, 'image.variables-define');
  const define = page.getByRole('dialog', { name: 'Define Variables' });
  await define.getByLabel('Visibility').check();
  await define.locator('[name=vis-name]').fill('shown');
  await define.getByRole('button', { name: 'OK' }).click();
  await idle(page);
  await expect(define).toBeHidden();
  const v = await page.evaluate(() => {
    const e = window.photoStudio;
    return { layers: e.doc.variables?.layers, background: e.doc.layers[0].id };
  });
  expect(v.layers).toEqual({ [v.background]: { visibility: 'shown' } });
});

test('importing layers from a copy whose embedded object changed keeps both contents', async ({ page }) => {
  await openImage(page, 120, 80, '#ffffff');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const data = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
    const l = newPixelLayer('Red', e.doc, gridFromImage(e.assets.tiles, { width: 20, height: 20, data }, 10, 10));
    e.command('Red', (d) => d.layers.push(l));
    e.selectLayers([l.id]);
  });
  await idle(page);
  await run(page, 'layer.embed-convert');
  // A copy of this document (as Image > Duplicate makes) whose object turned blue.
  const kept = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const { addRGBA } = await import('/src/features/embedded/render.ts');
    const { setContents } = await import('/src/features/embedded/contents.ts');
    const { importLayersFrom } = await import('/src/features/files/import-layers.ts');
    const copy = await deserialize(await serialize(e.doc, e.assets));
    const id = copy.document.layers[1].embed!.contents;
    const blue = await addRGBA(copy.assets, { width: 20, height: 20, data: new Uint8ClampedArray(1600).map((_, i) => (i % 4 === 2 || i % 4 === 3 ? 255 : 0)) });
    setContents(copy.document, { ...copy.document.embeds![id], composite: blue, project: undefined });
    await importLayersFrom(e, await serialize(copy.document, copy.assets), 'Copy.photo');
    const imported = e.doc.layers.at(-1)!.children[1];
    return { id, imported: imported.embed!.contents, original: e.doc.embeds![id].composite, importedComposite: e.doc.embeds![imported.embed!.contents].composite, blue };
  });
  expect(kept.imported).not.toBe(kept.id);
  expect(kept.importedComposite).toBe(kept.blue);
  expect(kept.original).not.toBe(kept.blue);
});

test('Revert and Revert to Snapshot drop what was added since', async ({ page }) => {
  await openImage(page, 120, 80, '#ffffff');
  await start(page, 'history.snapshot');
  await page.locator('dialog[open]').getByRole('button', { name: 'OK' }).click();
  await idle(page);
  // Mark the opened state as saved (as File > Save does).
  await page.evaluate(() => (window.photoStudio.saved = window.photoStudio.doc));
  const addState = () =>
    page.evaluate(() => {
      const e = window.photoStudio;
      e.command('Additions', (d) => {
        d.guides = [{ orientation: 'vertical', position: 40 }];
        d.slices = [{ id: 's', rect: { x: 0, y: 0, width: 10, height: 10 } }];
        d.annotations = { samplers: [{ x: 5, y: 5 }] };
      });
    });
  const keys = () => page.evaluate(() => ['guides', 'slices', 'annotations'].filter((k) => k in window.photoStudio.doc));
  await addState();
  await idle(page);
  const snapId = await page.evaluate(async () => {
    const { sessionSnapshots } = await import('/src/features/history-tools.ts');
    return sessionSnapshots(window.photoStudio)[0].id;
  });
  await run(page, 'history.restore-snapshot', snapId);
  expect(await keys()).toEqual([]);
  await addState();
  await run(page, 'file.revert');
  expect(await keys()).toEqual([]);
});

test('imported type keeps its size when the resolutions differ', async ({ page }) => {
  await openImage(page, 200, 100, '#ffffff');
  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 20, 60);
  await page.keyboard.type('Text');
  await page.keyboard.press('Escape');
  await idle(page);
  const inkWidth = () =>
    page.evaluate(async () => {
      const { compositeRGBA } = await import('/src/features/pixels.ts');
      const img = await compositeRGBA(window.photoStudio);
      let x0 = img.width, x1 = -1;
      for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4] < 128) (x0 = Math.min(x0, i % img.width)), (x1 = Math.max(x1, i % img.width));
      return x1 - x0;
    });
  const width = await inkWidth();
  // The same document at 300 pixels/inch (type at a quarter of the points),
  // imported into this 72 pixels/inch one with its own type hidden.
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const { setDocumentResolution } = await import('/src/model/text-layer.ts');
    const { importLayersFrom } = await import('/src/features/files/import-layers.ts');
    const copy = await deserialize(await serialize(e.doc, e.assets));
    setDocumentResolution(copy.document, { horizontalResolution: 300, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: 300, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' });
    copy.document.layers = copy.document.layers.filter((l) => l.kind === 'text');
    e.command('Hide', (d) => void (d.layers[1].visible = false));
    await importLayersFrom(e, await serialize(copy.document, copy.assets), 'Copy.photo');
  });
  await idle(page);
  expect(await inkWidth()).toBe(width);
});

test('Convert to Layers keeps type of an object with another resolution', async ({ page }) => {
  await openImage(page, 200, 100, '#ffffff');
  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 20, 60);
  await page.keyboard.type('Text');
  await page.keyboard.press('Escape');
  await idle(page);
  // Place a 300 pixels/inch copy of the type as an embedded object, alone.
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const { setDocumentResolution } = await import('/src/model/text-layer.ts');
    const { contentsFromFile, fittedTransform, insertInstance, instanceLayer } = await import('/src/features/embedded/contents.ts');
    const copy = await deserialize(await serialize(e.doc, e.assets));
    setDocumentResolution(copy.document, { horizontalResolution: 300, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: 300, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' });
    copy.document.layers = copy.document.layers.filter((l) => l.kind === 'text');
    const file = new File([await serialize(copy.document, copy.assets)], 'Type.photo');
    const c = await contentsFromFile(e, e.doc, e.assets, file, file.name);
    e.command('Hide', (d) => void (d.layers[1].visible = false));
    insertInstance(e, instanceLayer(c, 'Type', fittedTransform(e.doc, c.width, c.height)), c, 'Place');
  });
  await idle(page);
  const ink = () =>
    page.evaluate(async () => {
      const { compositeRGBA } = await import('/src/features/pixels.ts');
      const img = await compositeRGBA(window.photoStudio);
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
      return n;
    });
  const placed = await ink();
  expect(placed).toBeGreaterThan(100);
  await run(page, 'layer.embed-to-layers');
  expect(await page.evaluate(() => window.photoStudio.doc.layers.at(-1)!.children[0].kind)).toBe('text');
  expect(Math.abs((await ink()) - placed)).toBeLessThan(placed * 0.1);
});

test('Bitmap at another resolution moves guides and annotations with the pixels', async ({ page }) => {
  await openImage(page, 100, 80, '#808080');
  await page.evaluate(() => {
    const e = window.photoStudio;
    e.command('Marks', (d) => {
      d.guides = [{ orientation: 'vertical', position: 50 }];
      d.annotations = { samplers: [{ x: 10, y: 20 }] };
    });
  });
  await run(page, 'image.mode-grayscale');
  await start(page, 'image.mode-bitmap');
  const dialog = page.locator('dialog[open]');
  await dialog.locator('[name=resolution]').fill('144');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await idle(page);
  const d = await page.evaluate(() => {
    const doc = window.photoStudio.doc;
    return { size: [doc.width, doc.height], guides: doc.guides, samplers: doc.annotations?.samplers };
  });
  expect(d).toEqual({ size: [200, 160], guides: [{ orientation: 'vertical', position: 100 }], samplers: [{ x: 20, y: 40 }] });
});

test('scaling a pixel layer scales its linked layer mask and vector mask', async ({ page }) => {
  await openImage(page, 200, 200, '#ffffff');
  const setup = () =>
    page.evaluate(async () => {
      const e = window.photoStudio;
      const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
      const { gridFromImage, writeRect, emptyGrid } = await import('/src/model/tiles.ts');
      const data = new Uint8ClampedArray(40 * 40 * 4);
      for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
      const l = newPixelLayer('Red', e.doc, gridFromImage(e.assets.tiles, { width: 40, height: 40, data }, 20, 20));
      // The mask hides the left half of the layer.
      l.maskGrid = writeRect(e.assets.tiles, { ...emptyGrid(1), fill: 255 }, 20, 20, { width: 20, height: 40, data: new Uint8Array(800) });
      const k = (x: number, y: number) => ({ linked: false, points: [x, y, x, y, x, y] });
      l.vectorMask = { mask: { paths: [{ open: false, operation: 'combine', fillRule: 'non-zero', knots: [k(40, 20), k(60, 20), k(60, 60), k(40, 60)] }] } as never };
      e.command('Red', (d) => void (d.layers = [d.layers[0], l]));
      e.selectLayers([l.id]);
    });
  const state = () =>
    page.evaluate(async () => {
      const e = window.photoStudio;
      const { readMask } = await import('/src/model/tiles.ts');
      const l = e.doc.layers[1];
      const at = (x: number) => readMask(e.assets.tiles, l.maskGrid!, { x, y: 50, width: 1, height: 1 }).data[0];
      return { mask: [at(30), at(50), at(70), at(90)], vector: l.vectorMask!.mask.paths[0].knots.map((k) => k.points.slice(2, 4).map(Math.round)) };
    });
  const expected = { mask: [0, 0, 255, 255], vector: [[60, 20], [100, 20], [100, 100], [60, 100]] };
  // Scale 2× about the top left, as the move tool's handles or Properties do.
  await setup();
  await page.evaluate(() => window.photoStudio.editLayer('Scale', (l) => void (l.transform = { ...l.transform, width: 80, height: 80 })));
  await idle(page);
  expect(await state()).toEqual(expected);
  // The same through a distort session.
  await setup();
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { startSession } = await import('/src/features/transform/session.ts');
    const s = startSession(e, { mode: 'distort', quad: [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 20, y: 100 }] })!;
    s.apply();
  });
  await idle(page);
  expect(await state()).toEqual(expected);
});

test('scaling an embedded object or type scales its linked layer mask', async ({ page }) => {
  await openImage(page, 200, 200, '#ffffff');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const data = new Uint8ClampedArray(40 * 40 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
    const l = newPixelLayer('Red', e.doc, gridFromImage(e.assets.tiles, { width: 40, height: 40, data }, 20, 20));
    e.command('Red', (d) => void d.layers.push(l));
    e.selectLayers([l.id]);
  });
  await run(page, 'layer.embed-convert');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { writeRect, emptyGrid } = await import('/src/model/tiles.ts');
    // The mask hides the left half of the object.
    const mask = writeRect(e.assets.tiles, { ...emptyGrid(1), fill: 255 }, 20, 20, { width: 20, height: 40, data: new Uint8Array(800) });
    e.editLayer('Mask', (l) => void (l.maskGrid = mask));
    e.editLayer('Scale', (l) => void (l.transform = { ...l.transform, width: 80, height: 80 }));
  });
  await idle(page);
  const mask = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { readMask } = await import('/src/model/tiles.ts');
    const l = e.doc.layers[1];
    return [30, 50, 70, 90].map((x) => readMask(e.assets.tiles, l.maskGrid!, { x, y: 50, width: 1, height: 1 }).data[0]);
  });
  expect(mask).toEqual([0, 0, 255, 255]);
});

test('typing more text keeps the layer mask where it is', async ({ page }) => {
  await openImage(page, 200, 100, '#ffffff');
  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 20, 60);
  await page.keyboard.type('Ab');
  await page.keyboard.press('Escape');
  await idle(page);
  const mask = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { writeRect, emptyGrid } = await import('/src/model/tiles.ts');
    const m = writeRect(e.assets.tiles, { ...emptyGrid(1), fill: 255 }, 10, 30, { width: 20, height: 40, data: new Uint8Array(800) });
    e.editLayer('Mask', (l) => void (l.maskGrid = m));
    return JSON.stringify(e.doc.layers[1].maskGrid);
  });
  await idle(page);
  // Edit the text: the box grows, the mask stays.
  await canvasClick(page, 30, 55);
  await page.keyboard.press('End');
  await page.keyboard.type('cdefgh');
  await page.keyboard.press('Escape');
  await idle(page);
  expect(await page.evaluate(() => window.photoStudio.doc.layers[1].text)).toBe('Abcdefgh');
  expect(await page.evaluate(() => JSON.stringify(window.photoStudio.doc.layers[1].maskGrid))).toBe(mask);
});
