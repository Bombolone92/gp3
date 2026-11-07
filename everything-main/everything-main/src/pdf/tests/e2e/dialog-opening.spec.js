import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';

const dialogs = [
  ['File', 'Document details…', 'Document details'],
  ['File', 'Flatten…', 'Flatten'],
  ['File', 'Reduce file size…', 'Reduce file size'],
  ['File', 'Print…', 'Print'],
  ['File', 'Split PDF…', 'Split PDF'],
  ['File', 'Download pages as images…', 'Download pages as images'],
  ['Insert', 'Header and footer…', 'Header and footer'],
  ['Insert', 'Watermark…', 'Add watermark'],
  ['Insert', 'Page numbers…', 'Add page numbers'],
  ['Insert', 'Stamp…', 'Add stamp'],
  ['Page', 'Extract pages…', 'Extract pages'],
  ['Page', 'Add bookmark for this page…', 'Add bookmark'],
  ['Page', 'Delete page', 'Delete this page?'],
  [null, 'Sign', 'Add signature'],
  [null, 'Fill forms', 'Fill forms'],
];

async function openDialog(page, [section, action]) {
  if (!section)
    return page.getByRole('toolbar').getByRole('button', { name: action, exact: true }).click();
  const bar = page.getByRole('menubar');
  if (await bar.isVisible())
    await bar.getByRole('menuitem', { name: section, exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    if (section !== 'File')
      await page.getByRole('menuitem', { name: section, exact: true }).click();
  }
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

async function prepare(page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([400, 500]);
  doc.addPage([400, 500]);
  const field = doc.getForm().createTextField('Customer');
  field.setText('Original');
  field.addToPage(sheet, { x: 30, y: 300, width: 200, height: 30 });
  addNote(doc, 0, { x: 40, y: 220, text: 'Original' });
  await page.goto('/#library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'dialogs.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}

for (const opening of dialogs)
  for (const newer of ['none', 'open', 'closed'])
    test(`${opening[2]} waiting for a draft respects newer dialog ${newer}`, async ({ page }) => {
      await prepare(page);
      await page.getByRole('button', { name: 'Edit note: Original', exact: true }).click();
      await page.getByLabel('Note text', { exact: true }).fill('Updated');
      await page.evaluate(async () => {
        const { blankPdf, validatePdf } = await import('/src/core/document.js');
        const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
        const save = prototype.save;
        prototype.save = async function (...args) {
          prototype.save = save;
          const bytes = await save.apply(this, args);
          await new Promise((resolve) => {
            window.releaseDialogOpening = resolve;
          });
          return bytes;
        };
      });
      await openDialog(page, opening);
      await expect.poll(() => page.evaluate(() => !!window.releaseDialogOpening)).toBe(true);
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      if (newer !== 'none') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(settings).toBeVisible();
        if (newer === 'closed') {
          await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
          await expect(settings).toHaveCount(0);
          // Safari does not focus pointer-activated buttons. Choose a stable keyboard
          // target explicitly rather than treating lost body focus as a user choice.
          await page.getByRole('button', { name: 'Settings', exact: true }).focus();
        }
        await page.evaluate(() => {
          window.newerFocus = document.activeElement;
          document.activeElement.addEventListener('blur', () => {
            window.newerBlurred = true;
          });
        });
      }
      await page.evaluate(() => window.releaseDialogOpening());
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      // Observe after the save, reload, and dialog-opening continuations have settled.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const dialog = page.getByRole('dialog', { name: opening[2], exact: true });
      if (newer !== 'none') {
        await expect(dialog).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.activeElement === window.newerFocus && !window.newerBlurred,
          ),
        ).toBe(true);
        if (newer === 'open') {
          await expect(settings).toBeVisible();
          await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
          await expect(settings).toHaveCount(0);
        }
        // A later explicit request still opens normally.
        await openDialog(page, opening);
      }
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await downloading).path()));
      expect(listNotes(saved, 0).map((note) => note.text)).toEqual(['Updated']);
      expect(saved.getForm().getTextField('Customer').getText()).toBe('Original');
      expect(saved.getPageCount()).toBe(2);
    });

for (const opening of [dialogs[0], dialogs[6]])
  for (const newer of ['none', 'open', 'closed'])
    test(`${opening[2]} waiting for metadata code respects newer dialog ${newer}`, async ({
      page,
    }) => {
      await prepare(page);
      let release;
      const ready = new Promise((resolve) => {
        release = resolve;
      });
      const requested = page.waitForRequest('**/src/core/details.js');
      await page.route('**/src/core/details.js', async (route) => {
        await ready;
        await route.continue();
      });
      await openDialog(page, opening);
      await requested;
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      if (newer !== 'none') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(settings).toBeVisible();
        if (newer === 'closed') {
          await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
          await expect(settings).toHaveCount(0);
          // Safari does not focus pointer-activated buttons. Choose a stable keyboard
          // target explicitly rather than treating lost body focus as a user choice.
          await page.getByRole('button', { name: 'Settings', exact: true }).focus();
        }
        await page.evaluate(() => {
          window.newerFocus = document.activeElement;
        });
      }
      release();
      await page.evaluate(async () => {
        await import('/src/core/details.js');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const dialog = page.getByRole('dialog', { name: opening[2], exact: true });
      if (newer !== 'none') {
        await expect(dialog).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement === window.newerFocus)).toBe(true);
        if (newer === 'open') {
          await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
          await expect(settings).toHaveCount(0);
        }
        await openDialog(page, opening);
      }
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    });

for (const order of [
  [dialogs[0], dialogs[6]],
  [dialogs[6], dialogs[0]],
])
  test(`${order[1][2]} supersedes ${order[0][2]} while both await metadata code`, async ({
    page,
  }) => {
    await prepare(page);
    let release;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    const requested = page.waitForRequest('**/src/core/details.js');
    await page.route('**/src/core/details.js', async (route) => {
      await ready;
      await route.continue();
    });
    await openDialog(page, order[0]);
    await requested;
    await openDialog(page, order[1]);
    release();
    const newer = page.getByRole('dialog', { name: order[1][2], exact: true });
    await expect(newer).toBeVisible();
    await expect(page.getByRole('dialog', { name: order[0][2], exact: true })).toHaveCount(0);
    await expect(
      newer.getByLabel(order[1][2] === 'Document details' ? 'Title' : 'Top left', { exact: true }),
    ).toBeFocused();
    await newer.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(newer).toHaveCount(0);
    await openDialog(page, order[0]);
    await expect(page.getByRole('dialog', { name: order[0][2], exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });
