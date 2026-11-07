// Interaction timing budgets on a large document (4000 × 3000, 60 layers with
// text, styles, fill layers, groups and embedded objects). Opt-in, like the
// unit benchmarks: PHOTO_PERF=1 (budgets scale with PHOTO_PERF_SCALE, default
// 1). Each measurement is printed so runs can be compared (docs/performance.md).
import { test, expect, type Page } from '@playwright/test';
import { boot, idle } from './helpers';

const enabled = !!process.env.PHOTO_PERF;
const scale = Number(process.env.PHOTO_PERF_SCALE ?? 1);
test.describe.configure({ mode: 'serial' });
test.skip(!enabled, 'Set PHOTO_PERF=1 to run the performance budgets.');

/** Build the 60-layer document in the page with the model modules. */
async function largeDocument(page: Page) {
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newDocument, layer: newLayer } = await import('/src/model/document.ts');
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const { fromPlainText, defaultCharStyle } = await import('/src/imaging/text/model.ts');
    const { defaultDropShadow } = await import('/src/imaging/effects/types.ts');
    const W = 4000,
      H = 3000;
    const doc = newDocument(W, H, 'Large');
    e.history.reset(doc);
    e.hasDocument = true;
    const store = e.assets.tiles;
    const rgba = (w: number, h: number, seed: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          data[i] = (x * 255) / w;
          data[i + 1] = (y * 255) / h;
          data[i + 2] = (seed * 37) % 256;
          data[i + 3] = 255;
        }
      return { width: w, height: h, data };
    };
    const layers = [];
    const background = newPixelLayer('Background', doc, gridFromImage(store, rgba(W, H, 1), 0, 0));
    layers.push(background);
    const style = () => ({ enabled: true, dropShadow: [defaultDropShadow()], stroke: [{ enabled: true, size: 3, position: 'outside' as const, blendMode: 'normal' as const, opacity: 1, fill: { type: 'color' as const, color: [255, 255, 255] as [number, number, number] } }] });
    for (let i = 0; i < 30; i++) {
      const l = newPixelLayer(`Pixels ${i + 1}`, doc, gridFromImage(store, rgba(500, 360, i + 2), (i * 131) % (W - 500), (i * 97) % (H - 360)));
      if (i % 4 === 0) l.style = style() as never;
      layers.push(l);
    }
    for (let i = 0; i < 12; i++) {
      const text = `Caption ${i + 1} over the image`;
      const l = newLayer('text', text, 1, 1);
      l.textData = { content: fromPlainText(text, { ...defaultCharStyle(), size: 64 }), mode: 'point', origin: { x: 100 + (i % 4) * 900, y: 200 + Math.floor(i / 4) * 900 }, orientation: 'horizontal', antiAlias: 'smooth' } as never;
      l.text = text;
      if (i % 3 === 0) l.style = style() as never;
      layers.push(l);
    }
    for (let i = 0; i < 4; i++) {
      const l = newLayer('solid', `Fill ${i + 1}`, 1, 1);
      l.color = ['#204060', '#a03020', '#30a060', '#806020'][i];
      l.opacity = 0.2;
      l.transform = { x: i * 900, y: 2400, width: 800, height: 500, rotation: 0 };
      layers.push(l);
    }
    // Four groups of three pixel layers each.
    for (let g = 0; g < 4; g++) {
      const group = newLayer('group', `Group ${g + 1}`, 1, 1);
      group.children = [0, 1, 2].map((k) => newPixelLayer(`Grouped ${g + 1}.${k + 1}`, doc, gridFromImage(store, rgba(300, 300, g * 3 + k), 200 + g * 800 + k * 60, 1500 + k * 60)));
      layers.push(group);
    }
    e.command('Large document', (d) => d.layers.push(...layers));
    e.selected = layers.at(-1)!.id;
    e.update();
  });
  await idle(page);
  // Six embedded objects, made through the command (one undo step each).
  for (let i = 0; i < 6; i++) {
    await page.evaluate((i) => {
      const e = window.photoStudio;
      const l = e.doc.layers.find((x) => x.name === `Pixels ${i * 4 + 2}`)!;
      e.selectLayers([l.id]);
      return e.runCommand('layer.embed-convert');
    }, i);
    await idle(page);
  }
  const count = await page.evaluate(() => {
    const walk = (ls: { children: unknown[] }[]): number => ls.reduce((n, l) => n + 1 + walk(l.children as never), 0);
    return walk(window.photoStudio.doc.layers as never);
  });
  expect(count).toBeGreaterThanOrEqual(60);
}

/** Median of `runs` timings (ms) of an in-page action. */
async function measure(page: Page, label: string, budget: number, runs: number, action: () => Promise<number>) {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await action());
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1];
  console.log(`[perf] ${label}: median ${median.toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times.at(-1)!.toFixed(1)})`);
  expect(median, label).toBeLessThan(budget * scale);
  return median;
}

test('interaction budgets on a 60-layer 4000 × 3000 document', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await largeDocument(page);

  // A full workspace refresh (every panel, overlay and update hook).
  await measure(page, 'editor update', 40, 15, () =>
    page.evaluate(() => {
      const t = performance.now();
      window.photoStudio.update();
      return performance.now() - t;
    }),
  );

  // Selecting another layer from the Layers panel.
  const names = await page.evaluate(() => window.photoStudio.doc.layers.slice(1, 13).map((l) => l.id));
  let k = 0;
  await measure(page, 'select layer', 60, 12, () =>
    page.evaluate((id) => {
      const t = performance.now();
      window.photoStudio.selectLayer(id);
      return performance.now() - t;
    }, names[k++ % names.length]),
  );

  // Switching tools (options bar, toolbar, overlays and tool-dependent panels).
  const toolIds = ['brush', 'move', 'eraser', 'rect-marquee', 'type', 'crop', 'lasso', 'move'];
  let j = 0;
  await measure(page, 'switch tool', 40, 16, () =>
    page.evaluate((id) => {
      const t = performance.now();
      window.photoStudio.setTool(id);
      return performance.now() - t;
    }, toolIds[j++ % toolIds.length]),
  );
  await page.evaluate(() => window.photoStudio.setTool('move'));

  // Opening the Layer and Filter menus (building their items).
  let m = 0;
  await measure(page, 'open menu', 40, 10, () =>
    page.evaluate((i) => {
      const button = document.querySelectorAll<HTMLElement>('.menubar-button')[i];
      const t = performance.now();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      const ms = performance.now() - t;
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return ms;
    }, [3, 9][m++ % 2]),
  );

  // Refreshing the visible panels after an edit (Layers lists all 60 layers).
  await measure(page, 'panels update', 30, 15, () =>
    page.evaluate(() => {
      const t = performance.now();
      window.photoStudio.dock.update();
      return performance.now() - t;
    }),
  );
  await idle(page);

  // A brush stroke across the document on a new layer: the main-thread time
  // of each pointer event in the tool (painting into 4000 × 3000 tiles), and
  // committing the stroke on release. (Frame times in headless Chrome measure
  // its software GPU, so they are not budgeted here.)
  await page.evaluate(() => window.photoStudio.runCommand('layer.new-quick'));
  await idle(page);
  await page.evaluate(() => {
    const e = window.photoStudio;
    e.setTool('brush');
    const t = e.activeTool!;
    const w = window as unknown as { __moves: number[]; __up: number[] };
    w.__moves = [];
    w.__up = [];
    const move = t.pointerMove!,
      up = t.pointerUp!;
    t.pointerMove = (ed, p) => {
      const s = performance.now();
      move(ed, p);
      w.__moves.push(performance.now() - s);
    };
    t.pointerUp = async (ed, p) => {
      const s = performance.now();
      await up(ed, p);
      w.__up.push(performance.now() - s);
    };
  });
  // Pointer events are dispatched in the page, a frame apart: driving the
  // mouse from the test waits for each software-rendered frame.
  for (let k = 0; k < 3; k++) {
    await page.evaluate(async (k) => {
      const v = document.querySelector<HTMLElement>('#viewport')!;
      const r = v.getBoundingClientRect();
      const at = (i: number) => ({ clientX: r.left + r.width * (0.2 + i * 0.015), clientY: r.top + r.height * (0.3 + k * 0.1 + Math.sin(i / 5) * 0.1) });
      const send = (type: string, i: number) => v.dispatchEvent(new PointerEvent(type, { ...at(i), pointerId: 1, pointerType: 'mouse', button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5, bubbles: true, cancelable: true }));
      send('pointerdown', 0);
      for (let i = 1; i <= 40; i++) {
        await new Promise((res) => setTimeout(res, 16));
        send('pointermove', i);
      }
      send('pointerup', 40);
    }, k);
    // The commit, not the software-rendered frames that follow it.
    await page.waitForFunction((n) => !window.photoStudio.busy && !window.photoStudio.toolBusy && (window as unknown as { __up: number[] }).__up.length > n, k);
  }
  const stroke = await page.evaluate(() => {
    const w = window as unknown as { __moves: number[]; __up: number[] };
    return { __moves: w.__moves, __up: w.__up };
  });
  let n = 0;
  await measure(page, 'brush stroke: pointer move', 8, stroke.__moves.length, async () => stroke.__moves[n++]);
  n = 0;
  await measure(page, 'brush stroke: release and commit', 150, stroke.__up.length, async () => stroke.__up[n++]);

  // Undo and redo of the stroke (history step and workspace refresh; the
  // canvas renders afterwards).
  await measure(page, 'undo + redo', 60, 5, () =>
    page.evaluate(async () => {
      const e = window.photoStudio;
      const t = performance.now();
      await e.runCommand('edit.undo');
      await e.runCommand('edit.redo');
      return performance.now() - t;
    }),
  );
});
