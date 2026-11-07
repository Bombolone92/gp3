// Core editing flows: startup scene, selection, transforms, undo/redo, add/delete, menus, workspaces.
import { test, expect } from '@playwright/test';
import { openApp, hoverViewport, objectNames, expectNoErrors } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const A = 'window.app';
const get = (page: import('@playwright/test').Page, expr: string) => page.evaluate(`(() => { const app = ${A}; return ${expr}; })()`);

test('startup scene, layout workspace and editors', async ({ page }) => {
  const errors = await openApp(page);
  expect(await objectNames(page)).toEqual(['Camera', 'Cube', 'Light']);
  await expect(page.locator('.ws-tab.on', { hasText: 'Layout' })).toBeVisible();
  for (const name of ['Modeling', 'Sculpting', 'UV Editing', 'Shading', 'Animation', 'Rendering', 'Compositing', 'Geometry Nodes', 'Scripting'])
    await expect(page.locator('.ws-tab', { hasText: name }).first()).toBeVisible();
  await expect(page.locator('.outliner').getByText('Cube').first()).toBeVisible();
  expect(await get(page, `app.activeObject?.name`)).toBe('Cube');
  await expectNoErrors(errors);
});

test('move, rotate, scale with typed values, undo and redo', async ({ page }) => {
  const errors = await openApp(page);
  await hoverViewport(page);
  await page.keyboard.press('g');
  await page.keyboard.type('x2');
  await page.keyboard.press('Enter');
  expect(await get(page, `app.activeObject.location.map(v => +v.toFixed(3))`)).toEqual([2, 0, 0]);
  await page.keyboard.press('r');
  await page.keyboard.type('z90');
  await page.keyboard.press('Enter');
  expect(await get(page, `+(app.activeObject.rotation_euler[2] * 180 / Math.PI).toFixed(2)`)).toBe(90);
  await page.keyboard.press('s');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  expect(await get(page, `app.activeObject.scale.map(v => +v.toFixed(3))`)).toEqual([2, 2, 2]);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  expect(await get(page, `app.activeObject.scale[0]`)).toBe(1);
  expect(await get(page, `app.activeObject.rotation_euler[2]`)).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  expect(await get(page, `+(app.activeObject.rotation_euler[2] * 180 / Math.PI).toFixed(2)`)).toBe(90);
  await expectNoErrors(errors);
});

test('add menu, duplicate and delete objects', async ({ page }) => {
  const errors = await openApp(page);
  await hoverViewport(page);
  await page.keyboard.press('Shift+a');
  await page.getByText('Mesh', { exact: true }).first().hover();
  await page.getByText('UV Sphere', { exact: true }).first().click();
  await page.waitForTimeout(100);
  expect(await objectNames(page)).toContain('Sphere');
  await hoverViewport(page);
  await page.keyboard.press('Shift+d');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  expect(await objectNames(page)).toContain('Sphere.001');
  await page.keyboard.press('x');
  await page.getByText('Delete', { exact: true }).first().click();
  await page.waitForTimeout(100);
  expect(await objectNames(page)).not.toContain('Sphere.001');
  await expectNoErrors(errors);
});

test('click selection and box selection', async ({ page }) => {
  const errors = await openApp(page);
  const c = await hoverViewport(page);
  // click empty space deselects
  await page.mouse.click(c.box.x + 40, c.box.y + c.box.height - 60);
  await page.waitForTimeout(100);
  expect(await get(page, `Object.values(app.doc.objects).filter(o => o.select).length`)).toBe(0);
  // box over everything selects all three objects
  await page.mouse.move(c.box.x + 60, c.box.y + 60);
  await page.mouse.down();
  await page.mouse.move(c.box.x + c.box.width - 120, c.box.y + c.box.height - 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await get(page, `Object.values(app.doc.objects).filter(o => o.select).length`)).toBe(3);
  await expectNoErrors(errors);
});

test('lasso, circle tool, C circle modal and Ctrl+right-drag lasso select objects', async ({ page }) => {
  const errors = await openApp(page);
  const c = await hoverViewport(page);
  const selected = () => get(page, `Object.values(app.doc.objects).filter(o => o.select).map(o => o.name).sort().join(',')`);
  // screen position of the cube's origin
  const cube = await page.evaluate(async () => {
    const { activeView3D } = await import('/src/editors/view3d/view3d.ts');
    const v = activeView3D()!;
    const p = v.project(v.nav.pivot.clone().set(0, 0, 0));
    const r = v.el.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  });
  // lasso tool around the cube only
  await page.evaluate(async () => (await import('/src/editors/view3d/toolbar.ts')).setActiveTool('builtin.select_lasso'));
  const ring = (cx: number, cy: number, r: number) => Array.from({ length: 13 }, (_, i) => [cx + Math.cos((i / 12) * Math.PI * 2) * r, cy + Math.sin((i / 12) * Math.PI * 2) * r] as [number, number]);
  const drawPath = async (pts: [number, number][], button: 'left' | 'right' = 'left') => {
    await page.mouse.move(...pts[0]);
    await page.mouse.down({ button });
    for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 3 });
    await page.mouse.up({ button });
    await page.waitForTimeout(150);
  };
  await drawPath(ring(cube.x, cube.y, 70));
  expect(await selected()).toBe('Cube');
  // circle tool: painting over empty space with Shift adds nothing, over the camera adds it
  await page.evaluate(async () => (await import('/src/editors/view3d/toolbar.ts')).setActiveTool('builtin.select_circle'));
  await page.mouse.click(c.box.x + 30, c.box.y + c.box.height - 40);
  await page.waitForTimeout(100);
  expect(await selected()).toBe('');
  // C modal: paint over the cube, then right-click to finish
  await page.mouse.move(cube.x, cube.y);
  await page.keyboard.press('c');
  await page.mouse.down();
  await page.mouse.move(cube.x + 5, cube.y + 5, { steps: 3 });
  await page.mouse.up();
  await page.mouse.click(cube.x, cube.y, { button: 'right' });
  await page.waitForTimeout(100);
  expect(await selected()).toBe('Cube');
  expect(await get(page, 'app.modal')).toBeNull();
  // Ctrl+right-drag lasso adds the camera
  const cam = await page.evaluate(async () => {
    const { activeView3D } = await import('/src/editors/view3d/view3d.ts');
    const a = (window as any).app; // eslint-disable-line @typescript-eslint/no-explicit-any
    const v = activeView3D()!;
    const camOb = Object.values(a.doc.objects).find((o: any) => o.name === 'Camera') as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = v.project(v.nav.pivot.clone().set(...(camOb.location as [number, number, number])));
    const r = v.el.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  });
  await page.keyboard.down('Control');
  await drawPath(ring(cam.x, cam.y, 60), 'right');
  await page.keyboard.up('Control');
  expect(await selected()).toBe('Camera,Cube');
  await expectNoErrors(errors);
});

test('every workspace opens without errors', async ({ page }) => {
  const errors = await openApp(page);
  for (const name of ['Modeling', 'Sculpting', 'UV Editing', 'Texture Paint', 'Shading', 'Animation', 'Rendering', 'Compositing', 'Geometry Nodes', 'Scripting', 'Layout']) {
    await page.locator('.ws-tab', { hasText: name }).first().click();
    await page.waitForTimeout(400);
  }
  // workspaces that switch modes return to object mode on Layout
  expect(await get(page, `app.doc.mode`)).toBe('OBJECT');
  await expectNoErrors(errors);
});

test('F3 operator search runs an operator', async ({ page }) => {
  const errors = await openApp(page);
  await hoverViewport(page);
  await page.keyboard.press('F3');
  await page.keyboard.type('shade smooth');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const smooth = await get(page, `Array.from(app.doc.meshes[app.activeObject.data].smooth ?? []).every(Boolean)`);
  expect(smooth).toBe(true);
  await expectNoErrors(errors);
});

test('every workspace template from the + menu opens without errors', async ({ page }) => {
  const errors = await openApp(page);
  const templates = (await page.evaluate(async () => {
    const m = await import('/src/ui/screen.ts');
    return m.workspaceTemplates.map((t: { category: string; create: () => { name: string } }) => [t.category, t.create().name]);
  })) as [string, string][];
  const categories = new Set(templates.map(([c]) => c));
  for (const c of ['General', '2D Animation', 'VFX', 'Video Editing']) expect(categories.has(c), `category ${c}`).toBe(true);
  for (const [category, name] of templates.filter(([c]) => c !== 'General')) {
    await page.locator('.ws-add').click();
    await page.locator('.menu-item', { hasText: category }).first().hover();
    await page.locator('.menu-item', { hasText: name }).last().click();
    await page.waitForTimeout(500);
    await expect(page.locator('.ws-tab.on')).toContainText(name);
  }
  await expectNoErrors(errors);
});
