import { test, expect, type Page } from '@playwright/test';
import { boot, client, idle, openImage, run, start } from './helpers';

test.beforeEach(async ({ page }) => {
  await boot(page);
  await openImage(page, 600, 400, '#808080', 'gray.png');
});

async function addBoxes(page: Page) {
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { layer } = await import('/src/model/document.ts');
    e.command('Boxes', (d) => {
      const box = (name: string, x: number, y: number) => {
        const l = layer('solid', name, 80, 80);
        l.transform = { x, y, width: 80, height: 80, rotation: 0 };
        return l;
      };
      d.layers.push(box('A', 40, 60), box('B', 160, 60), box('C', 330, 200));
    });
    e.selectLayers([e.doc.layers.at(-1)!.id]);
    e.setTool('move');
    e.update();
  });
  await idle(page);
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await client(page, ...from),
    b = await client(page, ...to);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 10 });
  return async () => {
    await page.mouse.up();
    await idle(page);
  };
}
const boxX = (page: Page) => page.evaluate(() => window.photoStudio.doc.layers.at(-1)!.transform);

test('alignment guides snap to equal spacing and label the gaps', async ({ page }) => {
  await addBoxes(page);
  // B ends at 240 and the A–B gap is 40, so C (80 wide) settles at x = 280, y = 60.
  const release = await drag(page, [370, 240], [324, 102]);
  await expect(page.locator('#overlay .smart-label')).toHaveText(['40', '40']);
  await expect(page.locator('#overlay .smart-guide').first()).toBeAttached();
  await release();
  expect(await boxX(page)).toMatchObject({ x: 280, y: 60 });
  await expect(page.locator('#overlay .smart-label')).toHaveCount(0);
});

test('snap targets follow View > Snap To', async ({ page }) => {
  await addBoxes(page);
  await run(page, 'view.show-alignment-guides');
  await run(page, 'view.snap-none');
  let release = await drag(page, [370, 240], [324, 102]);
  await release();
  expect(await boxX(page)).toMatchObject({ x: 284, y: 62 });
  // Grid snapping alone: a 64 px grid with quarter subdivisions (16 px).
  await page.evaluate(() => (window.photoStudio.preferences.gridSize = 64));
  await run(page, 'view.snap-grid');
  release = await drag(page, [324, 102], [322, 99]);
  await release();
  // The center (322, 99) is nearest a grid line on both axes: 320 and 96.
  expect(await boxX(page)).toMatchObject({ x: 280, y: 56 });
  const checked = await page.evaluate(async () => {
    const { commands } = await import('/src/app/registry.ts');
    return ['view.snap-guides', 'view.snap-grid', 'view.snap-layers', 'view.snap-document'].map((id) => commands.get(id)!.checked!(window.photoStudio));
  });
  expect(checked).toEqual([false, true, false, false]);
});

test('guides are selected with the Move tool, edited and cleared', async ({ page }) => {
  await page.evaluate(() => {
    const e = window.photoStudio;
    e.command('Guides', (d) => {
      d.guides = [
        { orientation: 'vertical', position: 100 },
        { orientation: 'horizontal', position: 50 },
        { orientation: 'vertical', position: -40 },
      ];
    });
    e.setTool('move');
  });
  await idle(page);
  const [x] = await client(page, 100, 300);
  const [, y] = await client(page, 300, 300);
  await page.mouse.click(x, y);
  await expect(page.locator('#overlay .guide.selected')).toHaveCount(1);
  const [, gy] = await client(page, 300, 50);
  await page.keyboard.down('Shift');
  await page.mouse.click(x + 150, gy);
  await page.keyboard.up('Shift');
  await expect(page.locator('#overlay .guide.selected')).toHaveCount(2);
  // A click must not record a guide move.
  expect(await page.evaluate(() => window.photoStudio.history.labels.at(-1))).toBe('Guides');
  await start(page, 'view.guides-edit-selected');
  await page.locator('dialog[open] input[name="dx"]').fill('5');
  await page.locator('dialog[open] input[name="dy"]').fill('-10');
  await page.locator('dialog[open] button[type="submit"]').click();
  await idle(page);
  expect(await page.evaluate(() => window.photoStudio.doc.guides!.map((g) => g.position))).toEqual([105, 40, -40]);
  // The edited guides stay selected.
  await expect(page.locator('#overlay .guide.selected')).toHaveCount(2);
  await run(page, 'view.guides-clear-selected');
  expect(await page.evaluate(() => window.photoStudio.doc.guides)).toEqual([{ orientation: 'vertical', position: -40 }]);
  // Canvas guides clear; the pasteboard guide stays.
  await page.evaluate(() => window.photoStudio.command('More', (d) => void d.guides!.push({ orientation: 'horizontal', position: 10 })));
  await run(page, 'view.guides-clear-canvas');
  expect(await page.evaluate(() => window.photoStudio.doc.guides)).toEqual([{ orientation: 'vertical', position: -40 }]);
});

test('proof setup shows ink plates and color vision simulations', async ({ page }) => {
  // Proofs are display-only, so read what is on screen.
  const pixel = async () => {
    await idle(page);
    const [x, y] = await client(page, 300, 200);
    const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const g = new OffscreenCanvas(1, 1).getContext('2d')!;
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }, png.toString('base64'));
  };
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { layer } = await import('/src/model/document.ts');
    e.command('Red', (d) => {
      const l = layer('solid', 'Red', 600, 400);
      l.color = '#e01010';
      d.layers.push(l);
    });
  });
  await idle(page);
  const normal = await pixel();
  await run(page, 'view.proof-black-plate');
  await expect(page.locator('.document-tab.active')).toContainText('Working Black Plate');
  const black = await pixel();
  expect(Math.abs(black[0] - black[1])).toBeLessThanOrEqual(1);
  expect(Math.abs(black[1] - black[2])).toBeLessThanOrEqual(1);
  await run(page, 'view.proof-magenta-plate');
  const magenta = await pixel();
  // Strong red needs much more magenta ink than black: a darker plate.
  expect(magenta[0]).toBeLessThan(black[0] - 60);
  await run(page, 'view.proof-protan');
  await expect(page.locator('.document-tab.active')).toContainText('Protan Color Vision');
  const protan = await pixel();
  // Red loses most of its redness against green for a protan observer.
  expect(protan[0] - protan[1]).toBeLessThan((normal[0] - normal[1]) / 2);
  await run(page, 'view.proof-colors');
  const back = await pixel();
  for (let c = 0; c < 3; c++) expect(Math.abs(back[c] - normal[c])).toBeLessThanOrEqual(1);
});
