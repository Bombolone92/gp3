import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { commentPdf } from '../fixtures/indirect-comments.js';
import { listNotes } from '../../src/core/notes.js';
import { listHighlights } from '../../src/core/highlight.js';
import { clickAway } from './editing-helpers.js';

async function openPdf(page, doc) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'comments.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
}
async function exported(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await download).path()));
}
for (const [kind, label] of [
  ['note', 'note'],
  ['highlight', 'highlight'],
  ['underline', 'underline'],
  ['strikeout', 'strikethrough'],
])
  for (const flags of [4, 5])
    test(`an imported ${label} with an indirect subtype and flags ${flags} can be edited and deleted through history and reopening`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc, dict } = await commentPdf(kind);
      dict.set(PDFName.of('F'), PDFNumber.of(flags));
      await openPdf(page, doc);
      const target = (text) =>
        page.getByRole('button', { name: `Edit ${label}: ${text}`, exact: true });
      await target('Imported comment').click();
      const title = label[0].toUpperCase() + label.slice(1);
      if (kind === 'note')
        await page.getByLabel('Note text', { exact: true }).fill('Updated comment');
      await page.getByLabel(`${title} color`, { exact: true }).fill('#1144cc');
      await clickAway(page);
      const read = kind === 'note' ? listNotes : listHighlights;
      const text = kind === 'note' ? 'Updated comment' : 'Imported comment';
      const saved = await exported(page);
      expect(read(saved, 0)[0]).toMatchObject({ hex: '#1144cc', text });
      await target(text).click();
      await page.getByRole('button', { name: `Delete ${label}`, exact: true }).click();
      await expect(target(text)).toHaveCount(0);
      expect((await exported(page)).getPage(0).node.Annots().size()).toBe(0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(target(text)).toBeVisible();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(target(text)).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(target(text)).toBeVisible();
      const restored = await exported(page);
      expect(read(restored, 0)[0]).toMatchObject({ hex: '#1144cc', text });
      await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
      await openPdf(page, restored);
      await target(text).click();
      await expect(page.getByLabel(`${title} color`, { exact: true })).toHaveValue('#1144cc');
    });
