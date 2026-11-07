import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';
import { addHighlight, listHighlights } from '../../src/core/highlight.js';

async function prepare(page, kind, draft = false) {
  await page.route('https://js.puter.com/**', (route) => route.abort());
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([400, 500]);
  if (draft) addNote(doc, 0, { x: 40, y: 320, text: 'Draft' });
  if (kind === 'note') addNote(doc, 1, { x: 40, y: 320, text: 'Original' });
  else
    addHighlight(doc, 1, {
      text: 'Original',
      hex: '#ffff00',
      quads: [[40, 320, 180, 320, 40, 296, 180, 296]],
    });
  // Shared annotation references are valid imported content. An obsolete reveal must
  // not select the same object on whichever page a newer navigation reaches.
  doc.getPage(2).node.set(PDFName.of('Annots'), doc.getPage(1).node.Annots().clone());
  await page.goto('/#library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'comment-navigation.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 3');
  await showComments(page);
  if (draft) {
    await page.getByRole('button', { name: 'Note', exact: true }).click();
    const target = page.getByRole('button', { name: 'Edit note: Draft', exact: true });
    await target.focus();
    await target.press('Enter');
    await page.getByLabel('Note text', { exact: true }).fill('Updated draft');
  }
}
async function showComments(page) {
  const tabs = page.getByRole('tablist', { name: 'Side panel' });
  if (!(await tabs.isVisible()))
    await page.getByRole('button', { name: 'Toggle pages panel', exact: true }).click();
  await tabs.getByRole('tab', { name: /Comments/ }).click();
}
async function chooseComment(page, number) {
  const comment = page
    .getByRole('group', { name: 'Comments', exact: true })
    .getByRole('button', { name: new RegExp(`on page ${number}: Original`) });
  await comment.focus();
  await comment.press('Enter');
}
async function goTo(page, number) {
  const input = page.getByLabel('Page number', { exact: true });
  await input.fill(String(number));
  await input.press('Enter');
}
for (const kind of ['note', 'highlight'])
  for (const pending of ['render', 'draft'])
    for (const action of [
      'none',
      'next',
      'number',
      'current',
      ...(pending === 'render' ? ['comment'] : []),
    ])
      test(`${kind} comment waiting for ${pending} respects ${action === 'none' ? 'the original selection' : `a newer ${action} request`}`, async ({
        page,
      }) => {
        await prepare(page, kind, pending === 'draft');
        if (pending === 'render')
          await page.evaluate(() => {
            const post = Worker.prototype.postMessage;
            Worker.prototype.postMessage = function (message, ...rest) {
              if (message?.action === 'GetTextContent' && message.data.pageIndex === 1) {
                Worker.prototype.postMessage = post;
                window.releaseCommentNavigation = () => post.call(this, message, ...rest);
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
                window.releaseCommentNavigation = resolve;
              });
              return bytes;
            };
          });
        await chooseComment(page, 2);
        await expect.poll(() => page.evaluate(() => !!window.releaseCommentNavigation)).toBe(true);
        const destination = action === 'none' || action === 'current' ? 2 : 3;
        if (action === 'next')
          await page.getByRole('button', { name: 'Next page', exact: true }).click();
        else if (action === 'number' || action === 'current') await goTo(page, destination);
        else if (action === 'comment') {
          await showComments(page);
          await chooseComment(page, 3);
        }
        await page.evaluate(() => window.releaseCommentNavigation());
        await expect(page.locator('.page-caption')).toHaveText(`Page ${destination} of 3`);
        await expect(page.getByLabel('Page number', { exact: true })).toHaveValue(
          String(destination),
        );
        const control = page.getByLabel(kind === 'note' ? 'Note text' : 'Highlight color', {
          exact: true,
        });
        if (action === 'none' || action === 'comment') {
          await expect(control).toHaveValue(kind === 'note' ? 'Original' : '#ffff00');
          await expect(control).toBeFocused();
        } else {
          await expect(control).toHaveCount(0);
          // A later deliberate selection remains usable after retiring the old one.
          await showComments(page);
          await chooseComment(page, destination);
          await expect(control).toHaveValue(kind === 'note' ? 'Original' : '#ffff00');
        }
        await control.focus();
        if (kind === 'note') {
          await control.fill('Changed');
          await control.press('ControlOrMeta+Enter');
        } else await control.fill('#00aa00');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const saved = await PDFDocument.load(await readFile(await (await download).path()));
        expect(listNotes(saved, 0).map((note) => note.text)).toEqual(
          pending === 'draft' ? ['Updated draft'] : [],
        );
        for (const number of [2, 3]) {
          if (kind === 'note')
            expect(listNotes(saved, number - 1).map((note) => note.text)).toEqual([
              number === destination ? 'Changed' : 'Original',
            ]);
          else
            expect(listHighlights(saved, number - 1).map((mark) => mark.hex)).toEqual([
              number === destination ? '#00aa00' : '#ffff00',
            ]);
        }
      });
for (const kind of ['note', 'highlight'])
  test(`selecting a ${kind} comment on the rendered page opens its editor`, async ({ page }) => {
    await prepare(page, kind);
    await goTo(page, 2);
    await expect(page.locator('.page-caption')).toHaveText('Page 2 of 3');
    await chooseComment(page, 2);
    await expect(
      page.getByLabel(kind === 'note' ? 'Note text' : 'Highlight color', { exact: true }),
    ).toBeFocused();
    await expect(page.locator('.page-caption')).toHaveText('Page 2 of 3');
  });
