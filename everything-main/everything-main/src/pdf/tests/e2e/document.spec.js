import { test, expect } from '@playwright/test';
import { PDFDocument, PDFHexString, PDFName, decodePDFRawStream } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addMetadata } from '../fixtures/metadata.js';

const PUTER_MOCK = `window.puter = { env: 'web', auth: { isSignedIn: () => true, getUser: async () => ({username:'test-user'}), signIn: async () => {}, signOut: async () => {} }, fs: { readdir: async () => [], write: async () => ({}) }, ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} } };`;
async function mockPuter(page) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: PUTER_MOCK }),
  );
}
async function openPdf(page, doc, name = 'test.pdf', bytes) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes ?? (await doc.save())),
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
async function exported(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}
const settled = (page) => expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');

for (const storage of ['Info', 'XMP']) {
  for (const content of ['multiline', 'long']) {
    test(`Document details preserves untouched ${content} ${storage} fields`, async ({ page }) => {
      await mockPuter(page);
      await page.goto('/#library');
      const source = await PDFDocument.create();
      source.addPage([400, 300]);
      const title =
        content === 'multiline' ? '  First line\r\nSecond line  ' : 'Long title '.repeat(120);
      const subject = '  Summary\rwith another line\n  ';
      const keywords = '  preserved, spacing  ';
      source.setTitle(title);
      source.setSubject(subject);
      source.getInfoDict().set(PDFName.of('Keywords'), PDFHexString.fromText(keywords));
      if (storage === 'XMP') {
        const xml = addMetadata(source)
          .replace('>XMP title<', `>${title.replaceAll('\r', '&#13;')}<`)
          .replace('>XMP summary<', `>${subject.replaceAll('\r', '&#13;')}<`)
          .replace('>xmp, tags<', `>${keywords}<`);
        source.catalog.set(
          PDFName.of('Metadata'),
          source.context.register(
            source.context.flateStream(new TextEncoder().encode(xml), {
              Type: 'Metadata',
              Subtype: 'XML',
            }),
          ),
        );
      }
      await openPdf(page, source);
      await menu(page, 'Document details…');
      const dialog = page.getByRole('dialog', { name: 'Document details' });
      // Opening and saving without changes must leave the file and history alone.
      const originalAuthor = await dialog.getByLabel('Author').inputValue();
      await dialog.getByLabel('Author').fill('Draft author');
      await dialog.getByLabel('Author').fill(originalAuthor);
      await dialog.getByRole('button', { name: 'Save details' }).click();
      await expect(dialog).toHaveCount(0);
      await settled(page);
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await menu(page, 'Document details…');
      // Textareas normalize CR/CRLF for display; untouched source values stay exact.
      await expect(dialog.getByLabel('Title')).toHaveValue(title.replace(/\r\n?/g, '\n'));
      await expect(dialog.getByLabel('Subject')).toHaveValue(subject.replace(/\r\n?/g, '\n'));
      await dialog.getByLabel('Author').fill('Updated author');
      await dialog.getByRole('button', { name: 'Save details' }).click();
      await expect(dialog).toHaveCount(0);
      await settled(page);
      const saved = await exported(page);
      expect(saved.getTitle()).toBe(title);
      expect(saved.getSubject()).toBe(subject);
      expect(saved.getKeywords()).toBe(keywords);
      expect(saved.getAuthor()).toBe('Updated author');
      await menu(page, 'Document details…');
      await expect(dialog.getByLabel('Title')).toHaveValue(title.replace(/\r\n?/g, '\n'));
      await expect(dialog.getByLabel('Subject')).toHaveValue(subject.replace(/\r\n?/g, '\n'));
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await settled(page);
      await menu(page, 'Document details…');
      await dialog.getByRole('button', { name: 'Save details' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
    });
  }
}

test('Document details edits multiline values and restores them with undo and redo', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  doc.setTitle('Original title');
  await openPdf(page, doc);
  await menu(page, 'Document details…');
  const dialog = page.getByRole('dialog', { name: 'Document details' });
  await dialog.getByLabel('Title').fill('First line\nSecond line');
  await dialog.getByLabel('Subject').fill('First paragraph\n\nSecond paragraph');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await settled(page);
  let saved = await exported(page);
  expect(saved.getTitle()).toBe('First line\nSecond line');
  expect(saved.getSubject()).toBe('First paragraph\n\nSecond paragraph');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  expect((await exported(page)).getTitle()).toBe('Original title');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settled(page);
  saved = await exported(page);
  expect(saved.getTitle()).toBe('First line\nSecond line');
  expect(saved.getSubject()).toBe('First paragraph\n\nSecond paragraph');
});

test('editing an author preserves XML 1.0 separator characters in the title', async ({ page }) => {
  await mockPuter(page);
  await page.goto('/#library');
  const source = await PDFDocument.create();
  source.addPage([400, 300]);
  const title = 'Title\u0085with\u2028separators';
  const xml = addMetadata(source).replace('>XMP title<', `>${title}<`);
  source.catalog.set(
    PDFName.of('Metadata'),
    source.context.register(
      source.context.flateStream(new TextEncoder().encode(xml), {
        Type: 'Metadata',
        Subtype: 'XML',
      }),
    ),
  );
  await openPdf(page, source);
  await menu(page, 'Document details…');
  const dialog = page.getByRole('dialog', { name: 'Document details' });
  await expect(dialog.getByLabel('Title')).toHaveValue(title);
  await dialog.getByLabel('Author').fill('Updated author');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await settled(page);
  const saved = await exported(page);
  expect(saved.getTitle()).toBe(title);
  expect(saved.getAuthor()).toBe('Updated author');
  await menu(page, 'Document details…');
  await expect(dialog.getByLabel('Title')).toHaveValue(title);
});

test('Document details reconciles XMP, preserves translations, and restores both stores with undo', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  doc.setTitle('Old Info title');
  doc.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:custom="https://example.com/metadata/">
        <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Current XMP title</rdf:li><rdf:li xml:lang="fr">Titre français</rdf:li></rdf:Alt></dc:title>
        <dc:creator><rdf:Seq><rdf:li>Ada</rdf:li><rdf:li>Grace</rdf:li></rdf:Seq></dc:creator>
        <xmp:MetadataDate>2021-01-01T00:00:00Z</xmp:MetadataDate>
        <custom:id>keep-me</custom:id>
      </rdf:Description>
    </rdf:RDF></x:xmpmeta>`;
  doc.catalog.set(
    PDFName.of('Metadata'),
    doc.context.register(
      doc.context.flateStream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' }),
    ),
  );
  await openPdf(page, doc);
  await menu(page, 'Document details…');
  const dialog = page.getByRole('dialog', { name: 'Document details' });
  await expect(dialog.getByLabel('Title')).toHaveValue('Current XMP title');
  await expect(dialog.getByLabel('Author')).toHaveValue('Ada');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await expect(dialog).toHaveCount(0);
  await settled(page);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await menu(page, 'Document details…');
  await dialog.getByLabel('Title').fill('Final <title> & 日本語');
  await dialog.getByLabel('Author').fill('Katherine');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await settled(page);
  const saved = await exported(page);
  expect(saved.getTitle()).toBe('Final <title> & 日本語');
  expect(saved.getAuthor()).toBe('Katherine');
  const savedXml = new TextDecoder().decode(
    decodePDFRawStream(saved.catalog.lookup(PDFName.of('Metadata'))).decode(),
  );
  const properties = await page.evaluate((source) => {
    const dom = new DOMParser().parseFromString(source, 'application/xml');
    const dc = 'http://purl.org/dc/elements/1.1/';
    const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    const items = (name) =>
      Array.from(dom.getElementsByTagNameNS(dc, name)[0].getElementsByTagNameNS(rdf, 'li')).map(
        (node) => node.textContent,
      );
    return {
      errors: dom.getElementsByTagName('parsererror').length,
      titles: items('title'),
      authors: items('creator'),
      custom: dom.getElementsByTagNameNS('https://example.com/metadata/', 'id')[0].textContent,
    };
  }, savedXml);
  expect(properties).toEqual({
    errors: 0,
    titles: ['Final <title> & 日本語', 'Titre français'],
    authors: ['Katherine', 'Grace'],
    custom: 'keep-me',
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  expect((await exported(page)).getTitle()).toBe('Old Info title');
  await menu(page, 'Document details…');
  await expect(dialog.getByLabel('Title')).toHaveValue('Current XMP title');
  await expect(dialog.getByLabel('Author')).toHaveValue('Ada');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
});

test('Document details shows the file facts and saves the editable ones with undo', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  doc.setTitle('Draft');
  doc.setCreator('Test writer');
  doc.setProducer('Acme Writer 3.1');
  doc.setModificationDate(new Date('2020-05-06T07:08:09Z'));
  await openPdf(page, doc);
  await menu(page, 'Document details…');
  const dialog = page.getByRole('dialog', { name: 'Document details' });
  await expect(dialog.getByLabel('Title')).toHaveValue('Draft');
  await expect(dialog.getByLabel('Title')).toBeFocused();
  await expect(dialog.locator('.detail-facts')).toContainText('Pages');
  await expect(dialog.locator('.detail-facts')).toContainText('2');
  await expect(dialog.locator('.detail-facts')).toContainText('Test writer');
  // The facts describe the file as it is, not the working copy pdf-lib has just parsed.
  await expect(dialog.locator('.detail-facts')).toContainText('Acme Writer 3.1');
  await expect(dialog.locator('.detail-facts')).toContainText('2020');
  await dialog.getByLabel('Title').fill('Final report');
  await dialog.getByLabel('Author').fill('Ada Lovelace');
  await dialog.getByLabel('Keywords').fill('notes, engines');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await settled(page);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
  const saved = await exported(page);
  expect(saved.getTitle()).toBe('Final report');
  expect(saved.getAuthor()).toBe('Ada Lovelace');
  expect(saved.getKeywords()).toBe('notes, engines');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  expect((await exported(page)).getTitle()).toBe('Draft');
  // Saving without a change is no edit.
  await menu(page, 'Document details…');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
});

test('the Page menu turns every page at once and downloads a page as a PNG picture', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  await openPdf(page, doc);
  await menu(page, 'All pages');
  await page
    .getByRole('menu', { name: 'All pages' })
    .getByRole('menuitem', { name: 'Rotate all pages counterclockwise' })
    .click();
  await settled(page);
  expect((await exported(page)).getPages().map((p) => p.getRotation().angle)).toEqual([270, 270]);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.page-caption')).toHaveText('Page 2 of 2');
  const pending = page.waitForEvent('download');
  await menu(page, 'Download page as image');
  const download = await pending;
  expect(download.suggestedFilename()).toBe('test page 2.png');
  const png = await readFile(await download.path());
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  // 144 dpi doubles the point size; the turned page is taller than wide.
  expect(png.readUInt32BE(16)).toBe(600);
  expect(png.readUInt32BE(20)).toBe(800);
  await expect(page.locator('#toast')).toHaveText('Page 2 downloaded as a PNG picture.');
});

test('editing and downloading a header-only PDF 2.0 file preserves its version and UTF-8 metadata', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]).drawText('PDF 2.0 content');
  const title = PDFHexString.of('EFBBBF5064662032207469746C65');
  doc.getInfoDict().set(PDFName.of('Title'), title);
  const bytes = await doc.save();
  bytes[5] = 0x32;
  bytes[7] = 0x30;
  await openPdf(page, doc, 'version-2.pdf', bytes);
  await menu(page, 'All pages');
  await page
    .getByRole('menu', { name: 'All pages' })
    .getByRole('menuitem', { name: 'Rotate all pages counterclockwise' })
    .click();
  await settled(page);
  const saved = await exported(page);
  expect(saved.catalog.lookup(PDFName.of('Version')).decodeText()).toBe('2.0');
  expect(saved.getPage(0).getRotation().angle).toBe(270);
  expect(saved.getInfoDict().get(PDFName.of('Title')).toString()).toBe(title.toString());
});
