import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';

async function prepare(page, text = 'Updated note') {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      body: `window.puter = {
      env: 'web',
      auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test-user' }) },
      fs: { readdir: async () => [], write: async (path, blob) => {
        window.savedNotePdf = [...new Uint8Array(await blob.arrayBuffer())];
        return { path };
      } },
      ui: { onLaunchedWithItems() {}, onItemsOpened() {} }
    };`,
    }),
  );
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  addNote(doc, 0, { x: 40, y: 320, text: 'Original', hex: '#ffff00' });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'note-focus.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await page.getByRole('button', { name: 'Edit note: Original', exact: true }).click();
  const input = page.getByLabel('Note text', { exact: true });
  await input.fill(text);
  return input;
}

for (const action of ['keyboard', 'close', 'download', 'save', 'tool'])
  for (const moved of [false, true])
    for (const fails of [false, true])
      test(`${action} after a note ${fails ? 'failure' : 'commit'} ${moved ? 'preserves newer focus' : 'restores the expected focus'}`, async ({
        page,
      }) => {
        const input = await prepare(page);
        await page.evaluate(async (fails) => {
          const { blankPdf, validatePdf } = await import('/src/core/document.js');
          const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
          const save = prototype.save;
          prototype.save = async function (...args) {
            prototype.save = save;
            const bytes = await save.apply(this, args);
            await new Promise((resolve) => {
              window.releaseNote = resolve;
            });
            if (fails) throw new Error('Delayed note save failed.');
            return bytes;
          };
        }, fails);
        const download = page.getByRole('button', { name: 'Download', exact: true });
        const save = page.getByRole('button', { name: /^Save(?: to Puter)?$/, exact: true });
        const pending = action === 'download' && !fails ? page.waitForEvent('download') : null;
        if (action === 'keyboard') await input.press('ControlOrMeta+Enter');
        else {
          const button =
            action === 'close'
              ? page.getByRole('button', { name: 'Close note', exact: true })
              : action === 'tool'
                ? page.getByRole('button', { name: 'Text', exact: true })
                : action === 'save'
                  ? save
                  : download;
          await button.focus();
          await button.press('Enter');
        }
        await expect.poll(() => page.evaluate(() => !!window.releaseNote)).toBe(true);
        const settings = page.getByRole('button', { name: 'Settings', exact: true });
        if (moved) await settings.focus();
        await page.evaluate(() => window.releaseNote());
        let bytes;
        if (pending) bytes = await readFile(await (await pending).path());
        if (action === 'save' && !fails) {
          await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
          bytes = new Uint8Array(await page.evaluate(() => window.savedNotePdf));
        }
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        if (fails)
          await expect(page.locator('.note-editor [role="alert"]')).toHaveText(
            'Delayed note save failed.',
          );
        else if (action === 'tool')
          await expect(page.getByRole('group', { name: 'Edit note', exact: true })).toHaveCount(0);
        else
          await expect(
            page.getByRole('button', { name: 'Edit note: Updated note', exact: true }),
          ).toBeVisible();
        const target = moved
          ? settings
          : fails
            ? input
            : action === 'download'
              ? download
              : action === 'save'
                ? save
                : page.locator('.drawing-overlay');
        await expect(target).toBeFocused();
        if (fails) {
          await expect(input).toHaveValue('Updated note');
          await input.press('ControlOrMeta+Enter');
          await expect(page.getByRole('group', { name: 'Edit note', exact: true })).toHaveCount(0);
          await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        }
        if (!bytes) {
          const output = page.waitForEvent('download');
          await download.click();
          bytes = await readFile(await (await output).path());
        }
        expect(listNotes(await PDFDocument.load(bytes), 0).map((note) => note.text)).toEqual([
          'Updated note',
        ]);
        if (action === 'tool')
          await page.getByRole('button', { name: 'Select', exact: true }).click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Edit note: Original', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Edit note: Updated note', exact: true }),
        ).toBeVisible();
      });

for (const action of ['keyboard', 'close'])
  test(`an unchanged note returns focus to the page after ${action}`, async ({ page }) => {
    const input = await prepare(page, 'Original');
    if (action === 'keyboard') await input.press('ControlOrMeta+Enter');
    else await page.getByRole('button', { name: 'Close note', exact: true }).press('Enter');
    await expect(page.getByRole('group', { name: 'Edit note', exact: true })).toHaveCount(0);
    await expect(page.locator('.drawing-overlay')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });
