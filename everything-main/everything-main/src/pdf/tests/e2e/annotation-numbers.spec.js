import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';
import { addHighlight, listHighlights } from '../../src/core/highlight.js';

const PUTER_MOCK = `window.puter = { env: 'web', auth: { isSignedIn: () => true, getUser: async () => ({username:'test-user'}), signIn: async () => {}, signOut: async () => {} }, fs: { readdir: async () => [], write: async () => ({}) }, ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} } };`;
async function mockPuter(page) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: PUTER_MOCK }),
  );
}
async function openPdf(page, doc, name = 'test.pdf') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${doc.getPageCount()}`);
}

for (const kind of ['note', 'highlight'])
  for (const field of ['geometry', 'color'])
    test(`${kind} with indirect ${field} numbers stays editable without changing its color`, async ({
      page,
    }) => {
      await mockPuter(page);
      await page.goto('/#library');
      const doc = await PDFDocument.create();
      doc.addPage([400, 400]);
      if (kind === 'note') addNote(doc, 0, { x: 100, y: 300, text: 'Referenced', hex: '#1144cc' });
      else
        addHighlight(doc, 0, {
          quads: [[40, 220, 130, 220, 40, 196, 130, 196]],
          hex: '#1144cc',
          text: 'Referenced',
        });
      const dict = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
      const key = field === 'color' ? 'C' : kind === 'note' ? 'Rect' : 'QuadPoints';
      dict.set(
        PDFName.of(key),
        doc.context.obj(
          dict
            .lookup(PDFName.of(key))
            .asArray()
            .map((value) => doc.context.register(value)),
        ),
      );
      await openPdf(page, doc);
      const target = page.getByRole('button', { name: `Edit ${kind}: Referenced`, exact: true });
      await expect(target).toBeVisible();
      await target.click();
      const color = page.getByLabel(kind === 'note' ? 'Note color' : 'Highlight color', {
        exact: true,
      });
      await expect(color).toHaveValue('#1144cc');
      await color.fill('#00aa00');
      if (kind === 'note')
        await page.getByRole('button', { name: 'Close note', exact: true }).click();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await pending).path()));
      expect((kind === 'note' ? listNotes : listHighlights)(saved, 0)[0].hex).toBe('#00aa00');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await target.click();
      await expect(color).toHaveValue('#1144cc');
    });
