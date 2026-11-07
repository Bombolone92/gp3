import { test, expect, type Page } from '@playwright/test';
import { newDocument } from '../../src/model/document';
import { boot, downloadFrom, idle, menu, openProject, panel, redo, run, tool, undo } from './helpers';

const spin = (page: Page, name: string) => page.locator('#properties').getByRole('spinbutton', { name, exact: true });
const option = (page: Page, name: string) => page.locator('#tool-options').getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await boot(page);
  await openProject(page, newDocument(1600, 1000, 'Transform'), [], 'transform.photo');
  // Layer → New Fill Layer → Solid Color replaces the old "New color layer" button.
  await run(page, 'layer.fill-solid');
  await panel(page, 'Properties');
  for (const [label, value] of [
    ['W', '400'],
    ['H', '200'],
    ['X', '100'],
    ['Y', '100'],
  ]) {
    await spin(page, label).fill(value);
    await spin(page, label).press('Tab');
    await idle(page);
  }
  await expect(spin(page, 'W')).toHaveValue('400');
  await expect(spin(page, 'Y')).toHaveValue('100');
});
async function handle(page: Page, name: string) {
  const box = await page.locator(`[data-transform-handle="${name}"] .handle-hit`).boundingBox();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}
async function zoom(page: Page) {
  return (await page.locator('#stage').boundingBox())!.width / 1600;
}
async function resize(page: Page, dx: number, dy: number) {
  const p = await handle(page, 'se'),
    z = await zoom(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx * z, p.y + dy * z, { steps: 4 });
  await page.mouse.up();
}
test('Free Transform previews, cancels, commits as one undo step and supports nudges', async ({
  page,
}) => {
  await resize(page, 100, 50);
  await expect(option(page, 'Apply')).toBeVisible();
  await expect(spin(page, 'W')).toHaveValue('500');
  await expect(spin(page, 'H')).toHaveValue('250');
  await page.keyboard.press('Escape');
  await expect(spin(page, 'W')).toHaveValue('400');
  await resize(page, 100, 50);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');
  await idle(page);
  await expect(option(page, 'Apply')).toHaveCount(0);
  await expect(spin(page, 'X')).toHaveValue('101');
  await expect(spin(page, 'Y')).toHaveValue('110');
  await undo(page);
  await expect(spin(page, 'W')).toHaveValue('400');
  await expect(spin(page, 'X')).toHaveValue('100');
  await redo(page);
  await expect(spin(page, 'W')).toHaveValue('500');
});
test('rotation handle supports 15 degree constraints and locked layers cannot be transformed', async ({
  page,
}) => {
  const p = await handle(page, 'rotate'),
    z = await zoom(page);
  const stage = (await page.locator('#stage').boundingBox())!;
  const cx = stage.x + 300 * z,
    cy = stage.y + 200 * z;
  const radius = Math.hypot(p.x - cx, p.y - cy),
    a = -Math.PI / 4;
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(spin(page, 'Angle')).toHaveValue('45');
  await page.keyboard.press('Enter');
  await page.locator('#properties').getByRole('checkbox', { name: 'Lock layer', exact: true }).check();
  await idle(page);
  await expect(page.locator('[data-transform-handle]')).toHaveCount(0);
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  await expect(spin(page, 'X')).toHaveValue('100');
});
test('move snapping shows alignment guides, Alt bypasses it, and pointer cancellation rolls back', async ({
  page,
}) => {
  const stage = (await page.locator('#stage').boundingBox())!,
    z = await zoom(page);
  const start = { x: stage.x + 300 * z, y: stage.y + 200 * z };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 97 * z, start.y, { steps: 4 });
  // Moves draw alignment guides (View → Show → Alignment Guides).
  await expect(page.locator('.snap-guide, .smart-guide')).not.toHaveCount(0);
  await page.mouse.up();
  await expect(spin(page, 'X')).toHaveValue('0');
  await undo(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x - 97 * z, start.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const x = Number(await spin(page, 'X').inputValue());
  expect(x).toBeCloseTo(3, 0);
  // Switching tools during a move cancels that unfinished gesture.
  const current = { x: start.x - 97 * z, y: start.y };
  await page.mouse.move(current.x, current.y);
  await page.mouse.down();
  await page.mouse.move(current.x + 30, current.y + 10);
  await page.keyboard.press('b');
  await page.mouse.up();
  expect(
    Number(await spin(page, 'X').inputValue()),
  ).toBeCloseTo(x, 2);
  await tool(page, 'Move Tool');
  const p = await handle(page, 'se');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + 20);
  await page.locator('#viewport').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await option(page, 'Cancel').click();
  await expect(spin(page, 'W')).toHaveValue('400');
});

test('keyboard nudges work outside a session', async ({ page }) => {
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await idle(page);
  await expect(spin(page, 'X')).toHaveValue('101');
  await expect(spin(page, 'Y')).toHaveValue('110');
  await undo(page);
  await expect(spin(page, 'Y')).toHaveValue('100');
});

test('saving applies a pending transform', async ({ page }) => {
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await idle(page);
  await resize(page, 100, 50);
  const { bytes } = await downloadFrom(page, () => menu(page, 'File', 'Download Project (.photo)'));
  const manifest = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString());
  expect(manifest.document.layers[0].transform).toEqual({
    x: 101,
    y: 110,
    width: expect.closeTo(500, 3),
    height: expect.closeTo(250, 3),
    rotation: 0,
  });
  expect(manifest.document.layers[0].sourceWidth).toBe(1600);
  await expect(option(page, 'Apply')).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await undo(page);
  await expect(spin(page, 'W')).toHaveValue('400');
});
