import { commentPdf } from '../fixtures/indirect-comments.js';
import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFHexString, StandardFonts, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote } from '../../src/core/notes.js';

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

for (const layerType of ['direct', 'indirect group', 'indirect membership'])
  test(`flattening a ${layerType} layer-controlled comment keeps it hidden through download and undo`, async ({
    page,
  }) => {
    await mockPuter(page);
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    const sheet = doc.addPage([200, 200]);
    const hidden = doc.context.register(
      doc.context.obj({
        Type: layerType === 'direct' ? 'OCG' : doc.context.register(PDFName.of('OCG')),
        Name: PDFHexString.fromText('Hidden'),
      }),
    );
    doc.catalog.set(
      PDFName.of('OCProperties'),
      doc.context.obj({ OCGs: [hidden], D: { OFF: [hidden] } }),
    );
    const layer =
      layerType === 'indirect membership'
        ? doc.context.register(
            doc.context.obj({
              Type: doc.context.register(PDFName.of('OCMD')),
              OCGs: [hidden],
              P: 'AllOn',
              VE: ['And', hidden],
            }),
          )
        : hidden;
    sheet.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Square',
          Rect: [10, 10, 190, 190],
          F: 4,
          OC: layer,
          AP: {
            N: doc.context.register(
              doc.context.flateStream('1 0 0 rg 0 0 180 180 re f', {
                Type: 'XObject',
                Subtype: 'Form',
                BBox: [0, 0, 180, 180],
              }),
            ),
          },
        }),
      ),
    );
    await openPdf(page, doc);
    const center = () =>
      page
        .locator('.paper > canvas')
        .first()
        .evaluate((canvas) =>
          Array.from(
            canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data,
          ),
        );
    await expect.poll(center).toEqual([255, 255, 255, 255]);
    await flatten(page);
    await expect(page.locator('#toast')).toHaveText('Flattened 1 comment.');
    await expect.poll(center).toEqual([255, 255, 255, 255]);
    const saved = await downloaded(page);
    expect(saved.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settled(page);
    await expect.poll(center).toEqual([255, 255, 255, 255]);
    expect((await downloaded(page)).getPage(0).node.Annots().size()).toBe(1);
    await page.goto('/#library');
    await openPdf(page, saved);
    await expect.poll(center).toEqual([255, 255, 255, 255]);
  });

test('flattening keeps a visible appearance whose ordinary XObject use is layer-hidden', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([200, 200]);
  const hidden = doc.context.register(
    doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('Hidden XObject') }),
  );
  doc.catalog.set(
    PDFName.of('OCProperties'),
    doc.context.obj({ OCGs: [hidden], D: { OFF: [hidden] } }),
  );
  const appearance = doc.context.register(
    doc.context.flateStream('1 0 0 rg 0 0 180 180 re f', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 180, 180],
      OC: hidden,
    }),
  );
  sheet.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Square',
        Rect: [10, 10, 190, 190],
        F: 4,
        AP: { N: appearance },
      }),
    ),
  );
  await openPdf(page, doc);
  const center = () =>
    page
      .locator('.paper > canvas')
      .first()
      .evaluate((canvas) =>
        Array.from(
          canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data,
        ),
      );
  await expect.poll(center).toEqual([255, 0, 0, 255]);
  await flatten(page);
  await expect(page.locator('#toast')).toHaveText('Flattened 1 comment.');
  await expect.poll(center).toEqual([255, 0, 0, 255]);
  const saved = await downloaded(page);
  expect(saved.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  await expect.poll(center).toEqual([255, 0, 0, 255]);
});

test('Flatten bakes fields and comments into the page and can be undone', async ({ page }) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([400, 400]);
  const field = doc.getForm().createTextField('applicant');
  field.setText('Ada');
  field.addToPage(first, { x: 40, y: 300, width: 200, height: 30, font });
  addNote(doc, 0, { x: 300, y: 350, text: 'Looks good', author: 'Grace' });
  await openPdf(page, doc);
  await expect(page.getByRole('textbox', { name: /applicant/i })).toHaveValue('Ada');
  await menu(page, 'Flatten…');
  const dialog = page.getByRole('dialog', { name: 'Flatten' });
  await expect(dialog.getByLabel('Form fields (1)')).toBeChecked();
  await expect(dialog.getByLabel('Comments and markups (1)')).toBeChecked();
  await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Flattened 1 field and 1 comment.');
  await settled(page);
  await expect(page.getByRole('textbox', { name: /applicant/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /note: Looks good/ })).toHaveCount(0);
  // The value is still on the page as text.
  await expect(page.locator('.workspace .textLayer').getByText('Ada')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const flat = await PDFDocument.load(await readFile(await (await pending).path()));
  expect(flat.getForm().getFields()).toHaveLength(0);
  expect(flat.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  await expect(page.getByRole('textbox', { name: /applicant/i })).toHaveValue('Ada');
  await menu(page, 'Flatten…');
  await page.getByRole('dialog', { name: 'Flatten' }).getByLabel('Form fields (1)').uncheck();
  await page
    .getByRole('dialog', { name: 'Flatten' })
    .getByRole('button', { name: 'Flatten', exact: true })
    .click();
  await expect(page.locator('#toast')).toHaveText('Flattened 1 comment.');
  await settled(page);
  await expect(page.getByRole('textbox', { name: /applicant/i })).toHaveValue('Ada');
});

test('a PDF with nothing to flatten says so', async ({ page }) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  await openPdf(page, doc);
  await menu(page, 'Flatten…');
  await expect(page.locator('#toast')).toHaveText(
    'This PDF has no form fields or comments to flatten.',
  );
  await expect(page.getByRole('dialog', { name: 'Flatten' })).toHaveCount(0);
});

function legacyNote(doc, icon = 'Note') {
  const ref = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Name: icon,
      Rect: [40, 40, 60, 60],
      Contents: PDFHexString.fromText('Keep this note'),
      F: 4,
    }),
  );
  doc.getPage(0).node.addAnnot(ref);
  return ref;
}
async function flatten(page) {
  await menu(page, 'Flatten…');
  await page
    .getByRole('dialog', { name: 'Flatten' })
    .getByRole('button', { name: 'Flatten', exact: true })
    .click();
  await settled(page);
}
async function downloaded(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}

test('flattening a legacy note creates page content that survives download and undo', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  legacyNote(doc);
  await openPdf(page, doc);
  await flatten(page);
  await expect(page.locator('#toast')).toHaveText('Flattened 1 comment.');
  const saved = await downloaded(page);
  expect(saved.getPage(0).node.Contents()).toBeDefined();
  expect(saved.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  const original = await downloaded(page);
  const note = original.context.lookup(original.getPage(0).node.Annots().get(0));
  expect(note.lookup(PDFName.of('Contents')).decodeText()).toBe('Keep this note');
  expect(note.has(PDFName.of('AP'))).toBe(false);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settled(page);
  expect((await downloaded(page)).getPage(0).node.Annots()?.size() ?? 0).toBe(0);
});

test('an unsupported note stays editable and an unchanged flatten creates no undo step', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  legacyNote(doc, 'Help');
  await openPdf(page, doc);
  await flatten(page);
  await expect(page.locator('#toast')).toHaveText(
    'Kept 1 comment unflattened to preserve its content.',
  );
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.locator('.save-status')).toHaveText('Local file');
  const saved = await downloaded(page);
  const note = saved.context.lookup(saved.getPage(0).node.Annots().get(0));
  expect(note.lookup(PDFName.of('Contents')).decodeText()).toBe('Keep this note');
  expect(note.get(PDFName.of('Name')).toString()).toBe('/Help');
  expect(saved.getPage(0).node.Contents()).toBeUndefined();
});

test('partial flatten reports a retained field and exports its canonical value and widget', async ({
  page,
}) => {
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([300, 300]);
  const field = doc.getForm().createTextField('Keep value');
  field.setText('Ada');
  field.addToPage(sheet, { x: 30, y: 100, width: 200, height: 30 });
  doc.getForm().markFieldAsClean(field.ref);
  const widget = field.acroField.getWidgets()[0];
  // A valid stream with an unusable matrix must not remove the live field.
  doc.context
    .lookup(widget.getNormalAppearance())
    .dict.set(PDFName.of('Matrix'), doc.context.obj([0, 0, 0, 0, 0, 0]));
  legacyNote(doc);
  await openPdf(page, doc);
  await flatten(page);
  await expect(page.locator('#toast')).toHaveText(
    'Flattened 1 comment. Kept 1 field unflattened to preserve its content.',
  );
  await expect(page.getByRole('textbox', { name: /Keep value/ })).toHaveValue('Ada');
  const saved = await downloaded(page);
  expect(saved.getForm().getTextField('Keep value').getText()).toBe('Ada');
  expect(saved.getPage(0).node.Annots()?.size()).toBe(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  expect((await downloaded(page)).getPage(0).node.Annots()?.size()).toBe(2);
});

test('flattening preserves screen and print visibility through undo, redo, and reopening', async ({
  page,
}) => {
  await mockPuter(page);
  await page.addInitScript(() => {
    window.printedColors = [];
    window.print = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 200;
      const context = canvas.getContext('2d');
      context.drawImage(document.querySelector('.print-sheet img'), 0, 0, 200, 200);
      window.printedColors.push(
        [30, 70, 110, 150].map((x) => context.getImageData(x, 100, 1, 1).data[1]),
      );
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([200, 200]);
  const ctx = doc.context;
  const appearance = ctx.register(
    ctx.flateStream('1 0 0 rg 0 0 20 40 re f', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 20, 40],
      Resources: {},
    }),
  );
  for (const [i, flags] of [0, 4, 36, 6].entries()) {
    sheet.node.addAnnot(
      ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Square',
          F: flags,
          Rect: [20 + i * 40, 80, 40 + i * 40, 120],
          AP: { N: appearance },
        }),
      ),
    );
  }
  await openPdf(page, doc);
  const checkVisibility = async () => {
    await expect
      .poll(() =>
        page
          .locator('.paper > canvas')
          .first()
          .evaluate((canvas) =>
            [30, 70, 110, 150].map(
              (x) =>
                canvas
                  .getContext('2d')
                  .getImageData((x * canvas.width) / 200, canvas.height / 2, 1, 1).data[1],
            ),
          ),
      )
      .toEqual([0, 0, 255, 255]);
    const count = await page.evaluate(() => window.printedColors.length);
    await page.keyboard.press('ControlOrMeta+p');
    await page
      .getByRole('dialog', { name: 'Print', exact: true })
      .getByRole('button', { name: 'Print', exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => window.printedColors.length)).toBe(count + 1);
    const colors = await page.evaluate(() => window.printedColors.at(-1));
    expect(colors[0]).toBeGreaterThan(245);
    expect(colors[1]).toBeLessThan(10);
    expect(colors[2]).toBeLessThan(10);
    expect(colors[3]).toBeGreaterThan(245);
    await settled(page);
  };
  await checkVisibility();
  await flatten(page);
  await checkVisibility();
  const saved = await downloaded(page);
  expect(saved.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settled(page);
  await checkVisibility();
  expect((await downloaded(page)).getPage(0).node.Annots().size()).toBe(4);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settled(page);
  await checkVisibility();
  expect((await downloaded(page)).getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  await page.goto('/#library');
  await openPdf(page, saved);
  await checkVisibility();
});

for (const kind of ['note', 'highlight'])
  test(`flattening an indirect ${kind} counts it correctly and survives history and reopening`, async ({
    page,
  }) => {
    await mockPuter(page);
    await page.goto('/#library');
    const { doc } = await commentPdf(kind);
    await openPdf(page, doc);
    const hasInk = () =>
      page
        .locator('.paper > canvas')
        .first()
        .evaluate((canvas) =>
          canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, i) => i % 4 !== 3 && value < 240),
        );
    await expect.poll(hasInk).toBe(true);
    await menu(page, 'Flatten…');
    const dialog = page.getByRole('dialog', { name: 'Flatten' });
    await expect(dialog.getByLabel('Comments and markups (1)')).toBeChecked();
    await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
    await expect(page.locator('#toast')).toHaveText('Flattened 1 comment.');
    await settled(page);
    await expect.poll(hasInk).toBe(true);
    expect((await downloaded(page)).getPage(0).node.Annots().size()).toBe(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settled(page);
    expect((await downloaded(page)).getPage(0).node.Annots().size()).toBe(2);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await settled(page);
    const saved = await downloaded(page);
    expect(saved.getPage(0).node.Annots().size()).toBe(0);
    await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
    await openPdf(page, saved);
    await expect.poll(hasInk).toBe(true);
    await expect(
      page.getByRole('button', { name: `Edit ${kind}: Imported comment`, exact: true }),
    ).toHaveCount(0);
  });

for (const [rotation, expected] of [
  [90, [0, 1, -1, 0, 0, 0]],
  [180, [-1, 0, 0, -1, 0, 0]],
  [270, [0, -1, 1, 0, 0, 0]],
])
  test(`flattening a shared legacy note keeps its ${rotation}-degree page upright through export and history`, async ({
    page,
  }) => {
    await mockPuter(page);
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    doc.addPage([300, 300]).setRotation(degrees(rotation));
    legacyNote(doc);
    const shared = doc.context.register(doc.getPage(0).node.Annots());
    for (const sheet of doc.getPages()) sheet.node.set(PDFName.of('Annots'), shared);
    await openPdf(page, doc);
    await flatten(page);
    await expect(page.locator('#toast')).toHaveText('Flattened 2 comments.');
    const checkExport = async () => {
      const saved = await downloaded(page);
      const matrices = saved.getPages().map((sheet) => {
        expect(sheet.node.Annots().size()).toBe(0);
        const ref = sheet.node.Resources().lookup(PDFName.of('XObject')).values()[0];
        return saved.context
          .lookup(ref)
          .dict.lookup(PDFName.of('Matrix'))
          .asArray()
          .map((value) => value.asNumber());
      });
      expect(matrices).toEqual([[1, 0, 0, 1, 0, 0], expected]);
    };
    await checkExport();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('.page-caption')).toHaveText('Page 2 of 2');
    await expect(page.locator('.note-target')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settled(page);
    const original = await downloaded(page);
    for (const sheet of original.getPages()) {
      expect(sheet.node.Annots().size()).toBe(1);
      expect(original.context.lookup(sheet.node.Annots().get(0)).has(PDFName.of('AP'))).toBe(false);
    }
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await settled(page);
    await checkExport();
  });
