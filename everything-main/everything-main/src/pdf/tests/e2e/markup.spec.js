import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addHighlight, listHighlights, ensureMarkupAppearance } from '../../src/core/highlight.js';

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
test('existing underline and strikethrough annotations remain editable after reopening', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([400, 400]);
  pdfPage.drawText('Underline me', { x: 40, y: 300, size: 20 });
  pdfPage.drawText('Strike me', { x: 40, y: 200, size: 20 });
  addHighlight(doc, 0, {
    quads: [[40, 320, 180, 320, 40, 296, 180, 296]],
    hex: '#d92626',
    kind: 'underline',
    text: 'Underline me',
  });
  addHighlight(doc, 0, {
    quads: [[40, 220, 130, 220, 40, 196, 130, 196]],
    hex: '#1144cc',
    kind: 'strikeout',
    text: 'Strike me',
  });
  await openPdf(page, doc);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const bytes = new Uint8Array(await readFile(await (await pending).path()));
  const exported = listHighlights(await PDFDocument.load(bytes), 0);
  expect(exported.map((entry) => [entry.kind, entry.hex, entry.text])).toEqual([
    ['underline', '#d92626', 'Underline me'],
    ['strikeout', '#1144cc', 'Strike me'],
  ]);
  // Reopen: the markups are selectable in Select, recolorable, and deletable.
  await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
  await openPdf(page, await PDFDocument.load(bytes));
  await page.getByRole('button', { name: 'Edit underline: Underline me', exact: true }).click();
  const panel = page.getByRole('group', { name: 'Edit underline' });
  await panel.getByLabel('Underline color').fill('#00aa00');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Edit strikethrough: Strike me', exact: true }).click();
  await page.getByRole('button', { name: 'Delete strikethrough', exact: true }).click();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const final = listHighlights(
    await PDFDocument.load(await readFile(await (await again).path())),
    0,
  );
  expect(final.map((entry) => [entry.kind, entry.hex])).toEqual([['underline', '#00aa00']]);
});

test('Highlight only exposes highlighting and its keyboard placement creates a highlight', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  await openPdf(page, doc);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.getByLabel('Markup style', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Underline', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Strikethrough', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const exported = listHighlights(
    await PDFDocument.load(await readFile(await (await pending).path())),
    0,
  );
  expect(exported).toHaveLength(1);
  expect(exported[0].kind).toBe('highlight');
});

for (const [kind, label] of [
  ['highlight', 'highlight'],
  ['underline', 'underline'],
  ['strikeout', 'strikethrough'],
])
  test(`recoloring an imported ${label} retains its transparency through export and undo`, async ({
    page,
  }) => {
    await mockPuter(page);
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    addHighlight(doc, 0, {
      kind,
      text: 'Imported mark',
      hex: '#ff0000',
      quads: [[40, 220, 130, 220, 40, 196, 130, 196]],
    });
    const dict = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
    dict.set(PDFName.of('CA'), PDFNumber.of(0.7));
    dict.delete(PDFName.of('AP'));
    ensureMarkupAppearance(doc, dict);
    await openPdf(page, doc);
    await page.getByRole('button', { name: `Edit ${label}: Imported mark`, exact: true }).click();
    const title = label[0].toUpperCase() + label.slice(1);
    await page.getByLabel(`${title} color`, { exact: true }).fill('#0000ff');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const readMark = async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await pending).path()));
      return listHighlights(saved, 0)[0];
    };
    expect(await readMark()).toMatchObject({ hex: '#0000ff', opacity: 0.7 });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    expect(await readMark()).toMatchObject({ hex: '#ff0000', opacity: 0.7 });
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    expect(await readMark()).toMatchObject({ hex: '#0000ff', opacity: 0.7 });
  });

for (const [kind, label] of [
  ['highlight', 'highlight'],
  ['underline', 'underline'],
  ['strikeout', 'strikethrough'],
])
  test(`a content-locked ${label} permits color and deletion while preserving its text`, async ({
    page,
  }) => {
    await mockPuter(page);
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    addHighlight(doc, 0, {
      kind,
      text: 'Locked words',
      quads: [[40, 220, 130, 220, 40, 196, 130, 196]],
    });
    const dict = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
    dict.set(PDFName.of('F'), PDFNumber.of(4 | 512));
    const richText = '<body xmlns="http://www.w3.org/1999/xhtml"><p>Locked words</p></body>';
    dict.set(PDFName.of('RC'), PDFString.of(richText));
    await openPdf(page, doc);
    const target = page.getByRole('button', { name: `Edit ${label}: Locked words`, exact: true });
    await expect(target).toBeVisible();
    await target.click();
    const title = label[0].toUpperCase() + label.slice(1);
    await page.getByLabel(`${title} color`, { exact: true }).fill('#1144cc');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = await PDFDocument.load(await readFile(await (await pending).path()));
    const annotation = saved.context.lookup(saved.getPage(0).node.Annots().get(0));
    expect(listHighlights(saved, 0)[0]).toMatchObject({ hex: '#1144cc', text: 'Locked words' });
    expect(annotation.lookup(PDFName.of('RC')).decodeText()).toBe(richText);
    expect(annotation.lookup(PDFName.of('F')).asNumber()).toBe(4 | 512);
    await target.click();
    await page.getByRole('button', { name: `Delete ${label}`, exact: true }).click();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(target).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(target).toBeVisible();
  });
