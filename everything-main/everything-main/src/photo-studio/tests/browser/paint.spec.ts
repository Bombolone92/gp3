import { test, expect, type Page } from '@playwright/test';
import { boot, client, idle, redo, tool, undo } from './helpers';

// Read the current compositor output without re-rendering the committed document:
// the preview must be checked while the pointer is still pressed.
async function canvasSnapshot(page: Page) {
  return page.evaluate(async () => {
    const e = window.photoStudio;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const pixels = await e.renderer.pixels();
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(pixels));
    const at = (x: number, y: number) => Array.from(pixels.slice((y * e.doc.width + x) * 4, (y * e.doc.width + x) * 4 + 4));
    return {
      digest: Array.from(new Uint8Array(digest)),
      start: at(192, 160),
      middle: at(256, 160),
      end: at(316, 160),
      existing: at(90, 74),
      zoom: e.zoom,
      pan: { ...e.pan },
      stage: e.el('#stage').style.transform,
    };
  });
}

for (const backend of ['default', 'WebGL'] as const) {
  for (const label of ['Brush Tool', 'Pencil Tool']) {
    for (const existing of [false, true]) {
      test(`${label} preview stays in place on ${existing ? 'existing' : 'empty'} pixels (${backend})`, async ({ page }) => {
        await boot(page, backend);
        await page.evaluate(async (existing) => {
          const e = window.photoStudio;
          const { newDocument } = await import('/src/model/document.ts');
          const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
          const { emptyGrid, gridFromImage } = await import('/src/model/tiles.ts');
          const doc = newDocument(640, 384, 'Painting');
          const data = new Uint8ClampedArray(32 * 24 * 4);
          for (let i = 0; i < data.length; i += 4) data.set([20, 180, 70, 255], i);
          const grid = existing ? gridFromImage(e.assets.tiles, { width: 32, height: 24, data }, 80, 64) : emptyGrid(4);
          const layer = newPixelLayer('Paint', doc, grid);
          doc.layers = [layer];
          e.history.reset(doc);
          e.hasDocument = true;
          e.selected = layer.id;
          e.zoom = 0.75;
          e.pan = { x: 25, y: -10 };
          e.update();
        }, existing);
        await idle(page);
        await tool(page, label);
        await page.evaluate(async () => {
          const e = window.photoStudio;
          const { brushFor } = await import('/src/features/paint.ts');
          Object.assign(brushFor(e.tool), { smoothing: 0, hardness: 1 });
          e.setForeground('#e02040');
        });
        const before = await canvasSnapshot(page);
        const start = await client(page, 192, 160);
        await page.mouse.move(...start);
        await page.mouse.down();
        const first = await canvasSnapshot(page);
        expect(first.start).toEqual([224, 32, 64, 255]);
        const end = await client(page, 320, 160);
        await page.mouse.move(...end, { steps: 8 });
        const live = await canvasSnapshot(page);
        expect(live.start).toEqual([224, 32, 64, 255]);
        expect(live.middle).toEqual([224, 32, 64, 255]);
        expect(live.end).toEqual([224, 32, 64, 255]);
        expect(live.existing).toEqual(before.existing);
        expect(live.zoom).toBe(before.zoom);
        expect(live.pan).toEqual(before.pan);
        expect(live.stage).toBe(before.stage);
        await page.mouse.up();
        await idle(page);
        expect(await canvasSnapshot(page)).toEqual(live);
        await page.mouse.move(0, 0);
        expect(await canvasSnapshot(page)).toEqual(live);
        await undo(page);
        expect((await canvasSnapshot(page)).digest).toEqual(before.digest);
        await redo(page);
        expect((await canvasSnapshot(page)).digest).toEqual(live.digest);
      });
    }
  }
}
