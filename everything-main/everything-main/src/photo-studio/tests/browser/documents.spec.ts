import { test, expect, type Page } from '@playwright/test';
import { boot, canvasDrag, downloadFrom, historyLabels, idle, layerPixel, menu, openFiles, redo, run, tool, undo } from './helpers';

test.beforeEach(async ({ page }) => {
  await boot(page);
});

// File → New… opens a form dialog; the command holds the editor busy until it closes.
async function openNewDialog(page: Page) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.locator('.menubar-entry.open .menu-item[data-command="file.new"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function createDocument(page: Page, name: string, width: number, height: number) {
  await openNewDialog(page);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('spinbutton', { name: 'Width (px)' }).fill(String(width));
  await page.getByRole('spinbutton', { name: 'Height (px)' }).fill(String(height));
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#tab-size')).toHaveText(`${width} × ${height} px`);
  await idle(page);
}

async function imageFile(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 17;
    canvas.height = 11;
    canvas.getContext('2d')!.fillRect(0, 0, 17, 11);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return {
    name: 'Small image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  };
}

test('new transparent document exposes the canvas and remains open after undo or deletion', async ({
  page,
}) => {
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#dirty')).toBeHidden();
  await createDocument(page, 'Blank canvas', 320, 180);
  await expect(page.locator('#document-name')).toHaveText('Blank canvas');
  // Transparent documents now start with an empty pixel layer to paint on
  // (the old workspace opened with zero layers and created one on the first stroke).
  await expect(page.locator('#layer-count')).toHaveText('1');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#dirty')).toBeVisible();

  await tool(page, 'Brush Tool');
  await canvasDrag(page, [[160, 90], [180, 100]], 4);
  await expect.poll(() => historyLabels(page)).toEqual(['Brush Tool']);
  expect((await layerPixel(page, 170, 95))[3]).toBeGreaterThan(0);
  await expect(page.locator('#layer-count')).toHaveText('1');
  await undo(page);
  expect((await layerPixel(page, 170, 95))[3]).toBe(0);
  await expect(page.locator('#empty')).toBeHidden();
  await redo(page);
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await idle(page);
  await expect(page.locator('#layer-count')).toHaveText('0');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#dirty')).toBeVisible();
});

test('first image opens a sized document, while placing into a new document retains its canvas settings', async ({
  page,
}) => {
  const file = await imageFile(page);
  await openFiles(page, file);
  await expect(page.locator('#tab-size')).toHaveText('17 × 11 px');
  await expect(page.locator('#document-name')).toHaveText('Small image');
  await expect(page.locator('#empty')).toBeHidden();
  await createDocument(page, 'Custom canvas', 411, 237);
  // Opening a file now always opens its own tab; importing into the current
  // document is File → Place Embedded, which keeps the canvas size and name.
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'File', 'Place Embedded…');
  await (await chooser).setFiles(file);
  await expect(page.locator('#layer-count')).toHaveText('2');
  await idle(page);
  await expect(page.locator('#tab-size')).toHaveText('411 × 237 px');
  await expect(page.locator('#document-name')).toHaveText('Custom canvas');
  expect(await page.evaluate(() => window.photoStudio.layer && [window.photoStudio.layer.kind, window.photoStudio.layer.name])).toEqual(['image', 'Small image']);
  await expect(page.locator('.document-tab')).toHaveCount(2);
});

test('empty project saves and reopens as an editable document without replacing unsaved work', async ({
  page,
}) => {
  await createDocument(page, 'Empty project', 123, 79);
  // Delete the starting layer so the project is a zero-layer document.
  await run(page, 'layer.delete');
  await expect(page.locator('#layer-count')).toHaveText('0');
  const { bytes: buffer } = await downloadFrom(page, () => menu(page, 'File', 'Download Project (.photo)'));
  await expect(page.locator('#dirty')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => !!window.photoStudio?.renderer);
  await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
  const project = {
    name: 'Empty project.photo',
    mimeType: 'application/x-photo-editor',
    buffer,
  };
  await openFiles(page, project);
  await expect(page.locator('#tab-size')).toHaveText('123 × 79 px');
  await expect(page.locator('#layer-count')).toHaveText('0');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#dirty')).toBeHidden();
  await createDocument(page, 'Unsaved empty document', 219, 137);
  // Opening a project no longer asks to replace the current document; it opens
  // in another tab and the unsaved document stays untouched in its own tab.
  await openFiles(page, project);
  await expect(page.locator('.document-tab')).toHaveCount(3);
  await expect(page.locator('#document-name')).toHaveText('Empty project');
  await page.locator('.document-tab', { hasText: 'Unsaved empty document' }).click();
  await expect(page.locator('#document-name')).toHaveText('Unsaved empty document');
  await expect(page.locator('#tab-size')).toHaveText('219 × 137 px');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#dirty')).toBeVisible();
});

test('cancelling creation preserves both the welcome screen and an existing document', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await idle(page);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#dirty')).toBeHidden();
  await createDocument(page, 'Keep this canvas', 151, 83);
  await openNewDialog(page);
  await page.getByRole('spinbutton', { name: 'Width (px)' }).fill('999');
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await idle(page);
  await expect(page.locator('#document-name')).toHaveText('Keep this canvas');
  await expect(page.locator('#tab-size')).toHaveText('151 × 83 px');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('.document-tab')).toHaveCount(1);
});

test('creating a document recovers when the current document cannot render', async ({ page }) => {
  await createDocument(page, 'Broken source', 241, 157);
  await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer/renderer.ts');
    const prototype = Renderer.prototype as any;
    const draw = prototype.draw;
    prototype.draw = function (doc: { name: string }, assets: unknown) {
      if (doc.name === 'Broken source') return Promise.reject(new Error('The current source cannot render.'));
      return draw.call(this, doc, assets);
    };
  });
  // Layer → New Layer (the old "New paint layer" button).
  await run(page, 'layer.new-quick');
  await expect(page.locator('#toast')).toHaveText(/current source cannot render/);
  await createDocument(page, 'Fresh canvas', 193, 127);
  await expect(page.locator('#document-name')).toHaveText('Fresh canvas');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#canvas')).toHaveAttribute('width', '193');
  await expect(page.locator('#canvas')).toHaveAttribute('height', '127');
});

test('a document created while graphics initialize remains editable when initialization finishes', async ({
  page,
}) => {
  await page.route(/\/src\/renderer\/renderer\.ts(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}
const createBeforeInitializationTest = Renderer.create;
Renderer.create = async function (...args) {
  await new Promise(resolve => { globalThis.releaseGraphicsInitialization = resolve; });
  return createBeforeInitializationTest.apply(this, args);
};`,
    });
  });
  await page.reload();
  await page.waitForFunction(
    () => typeof (window as any).releaseGraphicsInitialization === 'function',
  );
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Created during startup');
  await page.getByRole('spinbutton', { name: 'Width (px)' }).fill('173');
  await page.getByRole('spinbutton', { name: 'Height (px)' }).fill('91');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#document-name')).toHaveText('Created during startup');
  await expect(page.locator('#empty')).toBeHidden();
  await page.evaluate(() => (window as any).releaseGraphicsInitialization());
  await page.waitForFunction(() => !!window.photoStudio?.renderer);
  await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
  await expect(page.locator('#tab-size')).toHaveText('173 × 91 px');
  await expect(page.locator('#canvas')).toHaveAttribute('width', '173');
  await run(page, 'layer.new-quick');
  await expect(page.locator('#layer-count')).toHaveText('2');
});
