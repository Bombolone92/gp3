import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const PUTER_MOCK = `window.puter = { env: 'web', auth: { isSignedIn: () => true, getUser: async () => ({username:'test-user'}), signIn: async () => {}, signOut: async () => {} }, fs: { readdir: async () => [], write: async () => ({}) }, ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} } };`;
async function mockPuter(page) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: PUTER_MOCK }),
  );
}
async function openPdf(page, doc) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${doc.getPageCount()}`);
}
/** Choose a menu item by name from the menu bar, or from the folded phone menu. */
async function menu(page, name) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  const item = page.getByRole('menu').getByRole('menuitem', { name, exact: true });
  if (await bar.isVisible()) {
    for (const title of ['File', 'Edit', 'View', 'Page', 'Insert']) {
      await bar.getByRole('menuitem', { name: title, exact: true }).click();
      if (await item.count()) return item.click();
      await page.keyboard.press('Escape');
    }
  } else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    if (await item.count()) return item.click();
    for (const section of ['Edit', 'View', 'Page', 'Insert']) {
      await page.getByRole('menu').getByRole('menuitem', { name: section, exact: true }).click();
      if (await item.count()) return item.click();
      await page.keyboard.press('Escape');
    }
  }
  throw new Error(`No menu item named ${name}`);
}
const settled = (page) => expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');

for (const kind of ['crop', 'details', 'form'])
  for (const fails of [false, true])
    test(`cancelling ${kind} serialization ignores a late ${fails ? 'failure' : 'success'} and preserves newer edits`, async ({
      page,
    }) => {
      await mockPuter(page);
      await page.goto('/#library');
      const doc = await PDFDocument.create();
      const sheet = doc.addPage([400, 500]);
      if (kind === 'form') {
        const field = doc.getForm().createTextField('Customer');
        field.setText('Original');
        field.addToPage(sheet, { x: 30, y: 300, width: 200, height: 30 });
      }
      await openPdf(page, doc);
      const openDialog = async () => {
        if (kind === 'crop') {
          await menu(page, 'Crop pages…');
          await page.getByRole('button', { name: 'Margins…', exact: true }).click();
        } else await menu(page, kind === 'details' ? 'Document details…' : 'Fill forms…');
      };
      await openDialog();
      const [title, label, value, action] = {
        crop: ['Crop pages', 'Top (pt)', '40', 'Crop'],
        details: ['Document details', 'Title', 'Pending title', 'Save details'],
        form: ['Fill forms', 'Customer', 'Pending customer', 'Save form'],
      }[kind];
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.getByLabel(label, { exact: true }).fill(value);
      await page.evaluate(async (fails) => {
        const { blankPdf, validatePdf } = await import('/src/core/document.js');
        const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
        const save = prototype.save;
        prototype.save = async function (...args) {
          prototype.save = save;
          const bytes = await save.apply(this, args);
          await new Promise((resolve) => {
            window.releaseDialogSave = resolve;
          });
          window.dialogSaveFinished = true;
          if (fails) throw new Error('Late serialization failure');
          return bytes;
        };
      }, fails);
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!window.releaseDialogSave)).toBe(true);
      await expect(dialog).toHaveAttribute('aria-busy', 'true');
      await expect(dialog.getByRole('button', { name: action, exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await settled(page);
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(page.locator('.save-status')).toHaveText('Local file');
      if (kind === 'crop')
        await expect(page.getByRole('button', { name: 'Margins…', exact: true })).toBeVisible();
      await openDialog();
      await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(
        kind === 'crop' ? '0' : kind === 'details' ? '' : 'Original',
      );
      await dialog.getByLabel(label, { exact: true }).fill(kind === 'crop' ? '80' : 'Newer edit');
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await settled(page);
      await page.evaluate(() => window.releaseDialogSave());
      await expect.poll(() => page.evaluate(() => window.dialogSaveFinished)).toBe(true);
      await settled(page);
      await expect(page.locator('#toast')).not.toContainText('Late serialization failure');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const exported = await PDFDocument.load(await readFile(await (await pending).path()));
      if (kind === 'crop') expect(exported.getPage(0).getCropBox().height).toBe(420);
      else if (kind === 'details') expect(exported.getTitle()).toBe('Newer edit');
      else expect(exported.getForm().getTextField('Customer').getText()).toBe('Newer edit');
    });
