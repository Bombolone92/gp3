import { expect, it, vi } from 'vitest';
import { createDecipheriv } from 'node:crypto';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cryptObjectStream } from './fixtures/crypt-object-stream.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

async function independent(bytes, password) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    return {
      title: (await pdf.getMetadata()).info.Title,
      size: page.view.slice(2),
      text: (await page.getTextContent()).items.map((item) => item.str).join(''),
    };
  } finally {
    await task.destroy();
  }
}
function privateStream(doc) {
  return doc
    .getPage(0)
    .node.lookup(PDFName.of('PieceInfo'))
    .lookup(PDFName.of('PDFEditor'))
    .lookup(PDFName.of('Private'));
}
for (const [label, options] of [
  ['AES-256', {}],
  ['AES-128', { legacy: true }],
  ['RC4', { rc4: true }],
])
  it(`honors explicit ${label} object and content stream filters over Identity defaults`, async () => {
    const { bytes, title, password } = await cryptObjectStream({
      crypt: 'StdCF',
      defaultIdentity: true,
      compressed: true,
      ...options,
      text: true,
    });
    const input = await independent(bytes, password);
    expect(input.title).toBe(title);
    expect(input.size).toEqual([510, 710]);
    expect(input.text).toContain(
      options.legacy || options.rc4 ? 'Secret report' : 'Named filter content',
    );
    const opened = await unlockPdf(bytes, password);
    const doc = await PDFDocument.load(opened.bytes);
    expect(doc.getTitle()).toBe(title);
    expect(doc.getPage(0).getSize()).toEqual({ width: 510, height: 710 });
    expect(await independent(opened.bytes)).toEqual(input);
    const exported = await protectPdf(opened.bytes, openedProtection(opened, password));
    expect(await independent(exported, password)).toEqual(input);
    expect(await independent(exported, 'owner')).toEqual(input);
  });

it('honors named filters for direct streams when no object stream is present', async () => {
  const { bytes, password } = await cryptObjectStream({
    defaultIdentity: true,
    objectStream: false,
    text: true,
  });
  const input = await independent(bytes, password);
  expect(input.text).toContain('Named filter content');
  const opened = await unlockPdf(bytes, password);
  expect(await independent(opened.bytes)).toEqual(input);
  expect(
    await independent(await protectPdf(opened.bytes, openedProtection(opened, password)), password),
  ).toEqual(input);
});

it('uses native AES for a large object stream whose explicit filter differs from its default', async () => {
  const { bytes, title } = await cryptObjectStream({
    crypt: 'StdCF',
    defaultIdentity: true,
    title: 'x'.repeat(100000),
  });
  const native = vi.spyOn(crypto.subtle, 'decrypt');
  try {
    const opened = await unlockPdf(bytes, 'reader');
    expect(native.mock.calls.length).toBe(1);
    const actual = (await PDFDocument.load(opened.bytes)).getTitle();
    expect(actual?.length).toBe(title.length);
    expect(actual).toBe(title);
  } finally {
    native.mockRestore();
  }
});

it('retains explicit legacy AES selection when Web Crypto is unavailable', async () => {
  const { bytes, title } = await cryptObjectStream({
    crypt: 'StdCF',
    defaultIdentity: true,
    legacy: true,
    title: 'x'.repeat(100000),
  });
  const random = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues: random });
  try {
    const opened = await unlockPdf(bytes, 'user');
    const actual = (await PDFDocument.load(opened.bytes)).getTitle();
    expect(actual?.length).toBe(title.length);
    expect(actual).toBe(title);
    const saved = await protectPdf(opened.bytes, openedProtection(opened, 'user'));
    expect((await PDFDocument.load((await unlockPdf(saved, 'user')).bytes)).getTitle()).toBe(title);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps large named streams on the native AES path and encrypted on original-protection export', async () => {
  const privateData = Uint8Array.from({ length: 200003 }, (_, i) => (i * 73) & 255);
  const { bytes, password } = await cryptObjectStream({
    defaultIdentity: true,
    objectStream: false,
    privateData,
  });
  const original = bytes.slice();
  const native = vi.spyOn(crypto.subtle, 'decrypt');
  try {
    const opened = await unlockPdf(bytes, password);
    expect(native.mock.calls.length).toBe(1);
    expect(privateStream(await PDFDocument.load(opened.bytes)).getContents()).toEqual(privateData);
    expect(bytes).toEqual(original);
    const saved = await protectPdf(opened.bytes, openedProtection(opened, password));
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    const contents = privateStream(raw).getContents();
    expect(Buffer.from(contents).equals(Buffer.from(privateData))).toBe(false);
    const decipher = createDecipheriv(
      'aes-256-cbc',
      opened.encryption.fileKey,
      contents.subarray(0, 16),
    );
    expect(Buffer.concat([decipher.update(contents.subarray(16)), decipher.final()])).toEqual(
      Buffer.from(privateData),
    );
    expect(
      privateStream(await PDFDocument.load((await unlockPdf(saved, password)).bytes)).getContents(),
    ).toEqual(privateData);
  } finally {
    native.mockRestore();
  }
});

it('encrypts explicitly selected streams even when the original default cipher is Identity', async () => {
  const { bytes, password } = await cryptObjectStream({
    defaultIdentity: true,
    objectStream: false,
  });
  const { encryption } = await unlockPdf(bytes, password);
  const doc = await PDFDocument.create();
  doc.addPage();
  const plain = Buffer.from('Private attachment data that must stay encrypted.');
  const ref = doc.context.register(
    doc.context.stream(plain, { Filter: 'Crypt', DecodeParms: { Name: 'StdCF' } }),
  );
  const date = doc
    .getInfoDict()
    .entries()
    .find(([key]) => key.decodeText() === 'CreationDate')[1];
  doc
    .getPage(0)
    .node.set(
      PDFName.of('PieceInfo'),
      doc.context.obj({ PDFEditor: { LastModified: date, Private: ref } }),
    );
  const saved = await protectPdf(await doc.save(), { original: encryption });
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
  const contents = privateStream(raw).getContents();
  expect(Buffer.from(contents).equals(plain)).toBe(false);
  const decipher = createDecipheriv('aes-256-cbc', encryption.fileKey, contents.subarray(0, 16));
  expect(Buffer.concat([decipher.update(contents.subarray(16)), decipher.final()])).toEqual(plain);
});

for (const used of [false, true])
  it(`${used ? 'rejects selected' : 'ignores unused'} unsupported stream encryption methods`, async () => {
    const { bytes, password } = await cryptObjectStream({
      defaultIdentity: true,
      objectStream: false,
      privateData: Buffer.from('Private data'),
    });
    const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    raw.context
      .lookup(raw.context.trailerInfo.Encrypt)
      .lookup(PDFName.of('CF'))
      .set(PDFName.of('Unsupported'), raw.context.obj({ CFM: 'Unsupported' }));
    if (used)
      privateStream(raw)
        .dict.lookup(PDFName.of('DecodeParms'))
        .lookup(0)
        .set(PDFName.of('Name'), PDFName.of('Unsupported'));
    const input = await raw.save({ useObjectStreams: false, updateFieldAppearances: false });
    const original = input.slice();
    if (used)
      await expect(unlockPdf(input, password)).rejects.toThrow(
        'This PDF uses an encryption method this app cannot open.',
      );
    else
      expect(
        privateStream(
          await PDFDocument.load((await unlockPdf(input, password)).bytes),
        ).getContents(),
      ).toEqual(new Uint8Array(Buffer.from('Private data')));
    expect(input).toEqual(original);
  });
