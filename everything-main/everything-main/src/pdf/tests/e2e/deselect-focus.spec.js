import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';
import { clickAway } from './editing-helpers.js';

async function prepare(page, kind, changed = true) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  if (kind === 'note') addNote(doc, 0, { x: 40, y: 320, text: 'Original', hex: '#ffff00' });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'deselect-focus.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  let input;
  if (kind === 'text') {
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
    input = page.getByRole('textbox', { name: 'Text to add', exact: true });
  } else {
    await page.getByRole('button', { name: 'Edit note: Original', exact: true }).click();
    input = page.getByLabel('Note text', { exact: true });
  }
  if (changed) await input.fill('Keep this draft');
  return input;
}

for (const kind of ['text', 'note']) {
  for (const moved of [false, true])
    test(`${kind} click-away commit ${moved ? 'preserves newer focus' : 'focuses the workspace'}`, async ({
      page,
    }) => {
      await prepare(page, kind);
      await page.evaluate(async () => {
        const { blankPdf, validatePdf } = await import('/src/core/document.js');
        const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
        const save = prototype.save;
        prototype.save = async function (...args) {
          prototype.save = save;
          const bytes = await save.apply(this, args);
          await new Promise((resolve) => {
            window.releaseDeselect = resolve;
          });
          return bytes;
        };
      });
      await clickAway(page);
      await expect.poll(() => page.evaluate(() => !!window.releaseDeselect)).toBe(true);
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (moved) await settings.focus();
      await page.evaluate(() => window.releaseDeselect());
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(moved ? settings : page.locator('.workspace')).toBeFocused();
      const target = page.getByRole('button', {
        name: `Edit ${kind}: Keep this draft`,
        exact: true,
      });
      await expect(target).toBeVisible();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const bytes = await readFile(await (await pending).path());
      if (kind === 'note')
        expect(listNotes(await PDFDocument.load(bytes), 0).map((note) => note.text)).toEqual([
          'Keep this draft',
        ]);
      else {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
        try {
          const content = await (await (await task.promise).getPage(1)).getTextContent();
          expect(content.items.map((item) => item.str).join('')).toBe('Keep this draft');
        } finally {
          await task.destroy();
        }
      }
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(target).toHaveCount(0);
      if (kind === 'note')
        await expect(
          page.getByRole('button', { name: 'Edit note: Original', exact: true }),
        ).toBeVisible();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(target).toBeVisible();
    });

  test(`clicking away from an unchanged ${kind} focuses the workspace after an outside control`, async ({
    page,
  }) => {
    const input = await prepare(page, kind, false);
    await page.getByRole('button', { name: 'Settings', exact: true }).focus();
    await clickAway(page);
    await expect(input).toHaveCount(0);
    await expect(page.locator('.workspace')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });
}
