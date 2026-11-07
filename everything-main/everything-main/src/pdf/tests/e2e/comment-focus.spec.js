import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';
import { addHighlight, listHighlights, MARKUP_KINDS } from '../../src/core/highlight.js';

for (const [kind, label] of [
  ['note', 'note'],
  ...Object.entries(MARKUP_KINDS).map(([kind, value]) => [kind, value.label]),
])
  for (const pending of ['render', 'draft'])
    for (const moved of [false, true])
      test(`${label} comment after ${pending} ${moved ? 'preserves newer focus' : 'focuses its editor'}`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.abort());
        const doc = await PDFDocument.create();
        doc.addPage([400, 500]);
        doc.addPage([400, 500]);
        if (pending === 'draft') addNote(doc, 0, { x: 40, y: 320, text: 'First page note' });
        if (kind === 'note') addNote(doc, 1, { x: 40, y: 320, text: 'Destination comment' });
        else
          addHighlight(doc, 1, {
            kind,
            text: 'Destination comment',
            hex: '#ffff00',
            quads: [[40, 320, 180, 320, 40, 296, 180, 296]],
          });
        await page.goto('/#library');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /^Open a PDF/ }).click();
        await (
          await chooser
        ).setFiles({
          name: 'comment-focus.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
        const tabs = page.getByRole('tablist', { name: 'Side panel' });
        if (!(await tabs.isVisible()))
          await page.getByRole('button', { name: 'Toggle pages panel', exact: true }).click();
        if (pending === 'draft') {
          await page.getByRole('button', { name: 'Note', exact: true }).click();
          const firstNote = page.getByRole('button', {
            name: 'Edit note: First page note',
            exact: true,
          });
          await firstNote.focus();
          await firstNote.press('Enter');
          await page.getByLabel('Note text', { exact: true }).fill('Updated first page note');
        }
        await tabs.getByRole('tab', { name: /Comments/ }).click();
        if (pending === 'render')
          await page.evaluate(() => {
            const post = Worker.prototype.postMessage;
            Worker.prototype.postMessage = function (message, ...rest) {
              if (message?.action === 'GetTextContent' && message.data.pageIndex === 1) {
                Worker.prototype.postMessage = post;
                window.releaseComment = () => post.call(this, message, ...rest);
              } else post.call(this, message, ...rest);
            };
          });
        else
          await page.evaluate(async () => {
            const { blankPdf, validatePdf } = await import('/src/core/document.js');
            const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
            const save = prototype.save;
            prototype.save = async function (...args) {
              prototype.save = save;
              const bytes = await save.apply(this, args);
              await new Promise((resolve) => {
                window.releaseComment = resolve;
              });
              return bytes;
            };
          });
        const comment = page
          .getByRole('group', { name: 'Comments', exact: true })
          .getByRole('button', { name: /on page 2: Destination comment/ });
        await comment.focus();
        await comment.press('Enter');
        await expect.poll(() => page.evaluate(() => !!window.releaseComment)).toBe(true);
        const settings = page.getByRole('button', { name: 'Settings', exact: true });
        if (moved) {
          await settings.focus();
          await settings.evaluate((node) =>
            node.addEventListener('blur', () => {
              window.commentFocusLost = true;
            }),
          );
        }
        await page.evaluate(() => window.releaseComment());
        const control = page.getByLabel(
          kind === 'note' ? 'Note text' : `${label[0].toUpperCase() + label.slice(1)} color`,
          { exact: true },
        );
        await expect(page.locator('.page-caption')).toHaveText('Page 2 of 2');
        await expect(control).toHaveValue(kind === 'note' ? 'Destination comment' : '#ffff00');
        await expect(moved ? settings : control).toBeFocused();
        if (moved) expect(await page.evaluate(() => !!window.commentFocusLost)).toBe(false);
        // The selected comment remains editable, and committing the preceding note must
        // not redirect or overwrite the destination annotation.
        await control.focus();
        if (kind === 'note') {
          await control.fill('Updated destination comment');
          await control.press('ControlOrMeta+Enter');
        } else await control.fill('#00aa00');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const saved = await PDFDocument.load(await readFile(await (await download).path()));
        expect(listNotes(saved, 0).map((note) => note.text)).toEqual(
          pending === 'draft' ? ['Updated first page note'] : [],
        );
        if (kind === 'note')
          expect(listNotes(saved, 1).map((note) => note.text)).toEqual([
            'Updated destination comment',
          ]);
        else
          expect(
            listHighlights(saved, 1).map((mark) => ({
              kind: mark.kind,
              text: mark.text,
              hex: mark.hex,
            })),
          ).toEqual([{ kind, text: 'Destination comment', hex: '#00aa00' }]);
      });
