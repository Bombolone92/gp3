import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import {
  blankPdf,
  preparePdfForEditing,
  insertPdfPages,
  PdfSession,
} from '../src/core/document.js';
import { flattenDocument } from '../src/core/flatten.js';
import { passwordFormPdf } from './fixtures/password-form.js';
import { defaultTextPdf } from './fixtures/default-text.js';
import { parentCycleKinds, parentCyclePdf } from './fixtures/form-cycles.js';
import { paintedText } from './helpers/painted-text.js';

for (const inherited of [false, true])
  for (const readOnly of [false, true])
    it(`masks imported password appearances without changing values or flags (${inherited}, ${readOnly})`, async () => {
      const { doc, secret } = await passwordFormPdf({ inherited, readOnly });
      secret.addToPage(doc.getPage(0), { x: 30, y: 80, width: 240, height: 30 });
      doc.setTitle('Original title');
      const date = new Date('2001-02-03T04:05:06Z');
      doc.setModificationDate(date);
      const original = await doc.save();
      expect(await paintedText(original)).toContain('Example passphrase');
      const bytes = await preparePdfForEditing(original);
      const painted = await paintedText(bytes);
      expect(painted).not.toContain('Example passphrase');
      expect(painted.match(/\*{18}/g)).toHaveLength(2);
      expect(painted).toContain('Original name');
      expect(painted).toContain('First lineSecond line');
      const saved = await PDFDocument.load(bytes, { updateMetadata: false });
      const field = saved.getForm().getTextField('Account.Secret');
      expect(field.getText()).toBe('Example passphrase');
      expect(field.isPassword()).toBe(true);
      expect(field.isReadOnly()).toBe(readOnly);
      expect(saved.getTitle()).toBe('Original title');
      expect(saved.getModificationDate()).toEqual(date);
      const session = new PdfSession(bytes);
      expect(session.dirty).toBe(false);
      await session.change((doc) => doc.setTitle('Updated title'));
      expect(session.undo()).toBe(true);
      expect(await paintedText(session.bytes)).toBe(painted);
      expect(session.redo()).toBe(true);
      expect(await paintedText(session.bytes)).toBe(painted);
    });

for (const current of ['absent', 'empty', 'override'])
  for (const inherited of [false, true])
    it(`preserves current and default password values on import (${current}, ${inherited})`, async () => {
      const { doc, shown } = await defaultTextPdf({ kind: 'password', current, inherited });
      const bytes = await preparePdfForEditing(await doc.save({ updateFieldAppearances: false }));
      expect(await paintedText(bytes)).toBe(shown + 'Original neighbor');
      const field = (await PDFDocument.load(bytes)).getForm().getTextField('Group.Value');
      expect(field.acroField.V() === undefined).toBe(current === 'absent');
      if (current !== 'absent') expect(field.getText()).toBe(current === 'empty' ? '' : 'Current');
    });

it('counts Unicode password code points without encoding the secret in the appearance font', async () => {
  const { doc, secret } = await passwordFormPdf();
  secret.setText('🔑漢字');
  const bytes = await preparePdfForEditing(await doc.save({ updateFieldAppearances: false }));
  expect(await paintedText(bytes)).toBe('***Original nameFirst lineSecond line');
  expect((await PDFDocument.load(bytes)).getForm().getTextField('Account.Secret').getText()).toBe(
    '🔑漢字',
  );
});

it('does not regenerate an unrelated dirty field while opening a password form', async () => {
  const { doc } = await passwordFormPdf();
  const neighbor = doc.getForm().getTextField('Name');
  neighbor.setText('漢字');
  neighbor.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
  const bytes = await preparePdfForEditing(await doc.save({ updateFieldAppearances: false }));
  const field = (await PDFDocument.load(bytes)).getForm().getTextField('Name');
  expect(field.getText()).toBe('漢字');
  expect(field.acroField.getWidgets()[0].dict.has(PDFName.of('AP'))).toBe(false);
});

it('clears stale rollover/down appearances and tolerates a widget with invalid rotation', async () => {
  const { doc, secret } = await passwordFormPdf();
  const widget = secret.acroField.getWidgets()[0];
  const normal = widget.getAppearances().normal;
  widget.setRolloverAppearance(doc.context.register(normal));
  widget.setDownAppearance(doc.context.register(normal));
  widget.getAppearanceCharacteristics().dict.set(PDFName.of('R'), PDFNumber.of(45));
  const bytes = await preparePdfForEditing(await doc.save());
  const saved = await PDFDocument.load(bytes);
  const field = saved.getForm().getTextField('Account.Secret');
  expect(field.getText()).toBe('Example passphrase');
  expect(field.acroField.getWidgets()[0].getAppearances().rollover).toBeUndefined();
  expect(field.acroField.getWidgets()[0].getAppearances().down).toBeUndefined();
  expect(await paintedText(bytes)).not.toContain('Example passphrase');
  // The fallback is a complete appearance, so subsequent saves do not retry bad layout.
  await expect(saved.save()).resolves.toBeInstanceOf(Uint8Array);
});

it('leaves documents without password fields byte-for-byte unchanged', async () => {
  const { doc, secret } = await passwordFormPdf();
  secret.disablePassword();
  for (const bytes of [await blankPdf(), await doc.save()])
    expect(await preparePdfForEditing(bytes)).toBe(bytes);
});

it.each(parentCycleKinds)(
  'preserves ordinary damaged forms without rewriting on open: %s',
  async (kind) => {
    const bytes = await parentCyclePdf(kind);
    expect(await preparePdfForEditing(bytes)).toBe(bytes);
  },
);

for (const action of ['flatten', 'insert'])
  it(`masks a valid existing password appearance during ${action}`, async () => {
    const { doc } = await passwordFormPdf({ inherited: true, readOnly: true });
    let bytes;
    if (action === 'flatten') {
      expect(flattenDocument(doc)).toEqual({ fields: 3, annotations: 0 });
      bytes = await doc.save();
    } else {
      const target = await PDFDocument.create();
      target.addPage([400, 400]);
      await insertPdfPages(target, await doc.save());
      bytes = await target.save();
    }
    const painted = await paintedText(bytes);
    expect(painted).not.toContain('Example passphrase');
    expect(painted).toContain('*'.repeat(18));
    expect(painted).toContain('Original name');
  });

for (const password of [false, true])
  for (const entry of ['FT', 'Ff', 'Parent'])
    it(`does not let an unreadable neighbor block import (password=${password}, ${entry})`, async () => {
      const { doc, secret } = await passwordFormPdf();
      if (!password) secret.disablePassword();
      doc
        .getForm()
        .getTextField('Name')
        .acroField.dict.set(PDFName.of(entry), PDFString.of('invalid'));
      const original = await doc.save({ updateFieldAppearances: false });
      const bytes = await preparePdfForEditing(original);
      if (!password) expect(bytes).toBe(original);
      else {
        expect(await paintedText(bytes)).not.toContain('Example passphrase');
        expect(await paintedText(bytes)).toContain('*'.repeat(18));
      }
    });

it('opens a PDF with an unreadable AcroForm without rewriting it', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.catalog.set(PDFName.of('AcroForm'), PDFString.of('invalid'));
  const bytes = await doc.save();
  expect(await preparePdfForEditing(bytes)).toBe(bytes);
});

for (const kids of ['bad entry', 'bad array'])
  it(`opens a password form with malformed widget children: ${kids}`, async () => {
    const { doc, secret } = await passwordFormPdf();
    if (kids === 'bad entry') secret.acroField.Kids().push(PDFString.of('invalid'));
    else {
      // A merged field/widget with an invalid Kids entry still has an appearance to mask.
      const widget = secret.acroField.getWidgets()[0];
      for (const [key, value] of widget.dict.entries())
        if (key !== PDFName.of('Parent')) secret.acroField.dict.set(key, value);
      secret.acroField.dict.set(PDFName.of('Kids'), PDFString.of('invalid'));
      doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([secret.ref]));
    }
    const bytes = await preparePdfForEditing(await doc.save({ updateFieldAppearances: false }));
    expect(await paintedText(bytes)).not.toContain('Example passphrase');
    expect(await paintedText(bytes)).toContain('*'.repeat(18));
  });

it('masks password fields after repairing a cyclic parent chain', async () => {
  const { doc, secret } = await passwordFormPdf({ inherited: true });
  const parent = secret.acroField.getParent();
  parent.dict.set(PDFName.of('Parent'), parent.ref);
  const bytes = await preparePdfForEditing(await doc.save({ updateFieldAppearances: false }));
  expect(await paintedText(bytes)).not.toContain('Example passphrase');
  expect(await paintedText(bytes)).toContain('*'.repeat(18));
});
