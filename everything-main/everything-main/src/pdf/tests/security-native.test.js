import { afterEach, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

const fixture = (name) => readFile(new URL(`./fixtures/security/${name}.pdf`, import.meta.url));
const content = () =>
  Uint8Array.from({ length: 200003 }, (_, i) => (i * 73 + Math.floor(i / 251)) & 255);
function addPrivateData(doc, bytes, extra = {}) {
  const ref = doc.context.register(doc.context.stream(bytes, extra));
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
}
function privateStream(doc) {
  return doc
    .getPage(0)
    .node.lookup(PDFName.of('PieceInfo'))
    .lookup(PDFName.of('PDFEditor'))
    .lookup(PDFName.of('Private'));
}
function independentDecrypt(stream, ref, opened) {
  const { fileKey, security } = opened.encryption;
  let key = fileKey;
  if (security.streamMethod === 'AESV2') {
    const num = ref.objectNumber,
      gen = ref.generationNumber;
    key = createHash('md5')
      .update(fileKey)
      .update(
        Buffer.from([
          num & 255,
          (num >> 8) & 255,
          (num >> 16) & 255,
          gen & 255,
          (gen >> 8) & 255,
          0x73,
          0x41,
          0x6c,
          0x54,
        ]),
      )
      .digest()
      .subarray(0, Math.min(fileKey.length + 5, 16));
  }
  const bytes = stream.getContents();
  const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, bytes.subarray(0, 16));
  return Buffer.concat([decipher.update(bytes.subarray(16)), decipher.final()]);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('encrypts a large new AES-256 stream natively and keeps its exact plaintext', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = content();
  addPrivateData(doc, bytes);
  const native = vi.spyOn(globalThis.crypto.subtle, 'encrypt');
  const saved = await protectPdf(await doc.save(), { open: 'reader', permissions: 'owner' });
  expect(native).toHaveBeenCalledTimes(1);
  const decrypt = vi.spyOn(globalThis.crypto.subtle, 'decrypt');
  const opened = await unlockPdf(saved, 'reader');
  expect(decrypt).toHaveBeenCalledTimes(1);
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true });
  const ref = raw
    .getPage(0)
    .node.lookup(PDFName.of('PieceInfo'))
    .lookup(PDFName.of('PDFEditor'))
    .get(PDFName.of('Private'));
  expect(independentDecrypt(privateStream(raw), ref, opened)).toEqual(Buffer.from(bytes));
  expect((await unlockPdf(saved, 'owner')).owner).toBe(true);
});

for (const name of ['aes-128', 'aes-128-plain-metadata', 'aes-256', 'aes-256-r5'])
  it(`uses native encryption for large ${name} streams without changing the original protection`, async () => {
    const opened = await unlockPdf(await fixture(name), 'user');
    const doc = await PDFDocument.load(opened.bytes);
    const bytes = content();
    addPrivateData(doc, bytes);
    const native = vi.spyOn(globalThis.crypto.subtle, 'encrypt');
    const saved = await protectPdf(await doc.save(), openedProtection(opened, 'user'));
    expect(native).toHaveBeenCalledTimes(1);
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true });
    const ref = raw
      .getPage(0)
      .node.lookup(PDFName.of('PieceInfo'))
      .lookup(PDFName.of('PDFEditor'))
      .get(PDFName.of('Private'));
    expect(independentDecrypt(privateStream(raw), ref, opened)).toEqual(Buffer.from(bytes));
    const decrypt = vi.spyOn(globalThis.crypto.subtle, 'decrypt');
    const again = await unlockPdf(saved, 'user');
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(privateStream(await PDFDocument.load(again.bytes)).getContents()).toEqual(bytes);
    expect(again.owner).toBe(false);
    expect(again.encryption.fileKey).toEqual(opened.encryption.fileKey);
    expect(again.encryption.security.P).toBe(opened.encryption.security.P);
    expect(again.encryption.security.R).toBe(opened.encryption.security.R);
    expect((await unlockPdf(saved, 'owner')).owner).toBe(true);
  });

it('leaves large Identity-filter streams and clear metadata unencrypted', async () => {
  const opened = await unlockPdf(await fixture('aes-128-plain-metadata'), 'user');
  const doc = await PDFDocument.load(opened.bytes);
  const bytes = content();
  addPrivateData(doc, bytes, { Filter: 'Crypt', DecodeParms: { Name: 'Identity' } });
  const metadata = new TextEncoder().encode(
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">${' '.repeat(100000)}</x:xmpmeta>`,
  );
  doc.catalog.set(
    PDFName.of('Metadata'),
    doc.context.register(doc.context.stream(metadata, { Type: 'Metadata', Subtype: 'XML' })),
  );
  const native = vi.spyOn(globalThis.crypto.subtle, 'encrypt');
  const saved = await protectPdf(await doc.save(), openedProtection(opened, 'user'));
  expect(native).not.toHaveBeenCalled();
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true });
  expect(privateStream(raw).getContents()).toEqual(bytes);
  expect(raw.catalog.lookup(PDFName.of('Metadata')).getContents()).toEqual(metadata);
  const decrypt = vi.spyOn(globalThis.crypto.subtle, 'decrypt');
  const openedAgain = await unlockPdf(saved, 'user');
  expect(decrypt).not.toHaveBeenCalled();
  expect(privateStream(await PDFDocument.load(openedAgain.bytes)).getContents()).toEqual(bytes);
});

it('keeps small streams on the existing path', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  addPrivateData(doc, content().subarray(0, 100));
  const native = vi.spyOn(globalThis.crypto.subtle, 'encrypt');
  const saved = await protectPdf(await doc.save(), { open: 'reader' });
  expect(native).not.toHaveBeenCalled();
  expect(
    privateStream(await PDFDocument.load((await unlockPdf(saved, 'reader')).bytes)).getContents(),
  ).toEqual(content().subarray(0, 100));
});

it('propagates native encryption failures without modifying the source bytes', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  addPrivateData(doc, content());
  const bytes = await doc.save(),
    original = bytes.slice();
  vi.spyOn(globalThis.crypto.subtle, 'encrypt').mockRejectedValue(
    new Error('Native encryption failed'),
  );
  await expect(protectPdf(bytes, { open: 'reader' })).rejects.toThrow('Native encryption failed');
  expect(bytes).toEqual(original);
});

it('can still re-encrypt legacy AES PDFs when Web Crypto is unavailable', async () => {
  const opened = await unlockPdf(await fixture('aes-128'), 'user');
  const doc = await PDFDocument.load(opened.bytes);
  const bytes = content();
  addPrivateData(doc, bytes);
  const plain = await doc.save();
  const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal('crypto', { getRandomValues: random });
  const saved = await protectPdf(plain, openedProtection(opened, 'user'));
  expect(
    privateStream(await PDFDocument.load((await unlockPdf(saved, 'user')).bytes)).getContents(),
  ).toEqual(bytes);
});

async function largeObjectStream() {
  const doc = await PDFDocument.create();
  doc.addPage();
  const saved = await protectPdf(await doc.save(), { open: 'reader' });
  const opened = await unlockPdf(saved, 'reader');
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
  const inner = raw.context.nextRef();
  const outer = raw.context.nextRef();
  const title = 'x'.repeat(100000);
  const header = new TextEncoder().encode(`${inner.objectNumber} 0 `);
  const body = Buffer.from(`${inner.objectNumber} 0 << /Title (${title}) >>`);
  const iv = Buffer.alloc(16, 73);
  const cipher = createCipheriv('aes-256-cbc', opened.encryption.fileKey, iv);
  const encrypted = Buffer.concat([iv, cipher.update(body), cipher.final()]);
  raw.context.assign(
    outer,
    raw.context.stream(encrypted, { Type: 'ObjStm', N: 1, First: header.length }),
  );
  raw.context.delete(raw.context.trailerInfo.Info);
  raw.context.trailerInfo.Info = inner;
  const bytes = await raw.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes, title };
}

it('decrypts large deferred object streams before parsing their plaintext objects', async () => {
  const { bytes, title } = await largeObjectStream();
  const native = vi.spyOn(globalThis.crypto.subtle, 'decrypt');
  const result = await unlockPdf(bytes, 'reader');
  expect(native).toHaveBeenCalledTimes(1);
  expect((await PDFDocument.load(result.bytes)).getTitle()).toBe(title);
});

it('reports native object-stream decryption errors instead of silently dropping their objects', async () => {
  const { bytes } = await largeObjectStream();
  const original = bytes.slice();
  vi.spyOn(globalThis.crypto.subtle, 'decrypt').mockRejectedValue(
    new Error('Native object-stream decryption failed'),
  );
  await expect(unlockPdf(bytes, 'reader')).rejects.toThrow(
    'Native object-stream decryption failed',
  );
  expect(bytes).toEqual(original);
});

it('preserves the existing recovery for AES streams with missing padding', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = content().subarray(0, 200000).slice();
  bytes[bytes.length - 1] = 0;
  addPrivateData(doc, bytes);
  const saved = await protectPdf(await doc.save(), { open: 'reader' });
  const opened = await unlockPdf(saved, 'reader');
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
  const iv = Buffer.alloc(16, 37);
  const cipher = createCipheriv('aes-256-cbc', opened.encryption.fileKey, iv);
  cipher.setAutoPadding(false);
  privateStream(raw).contents = Buffer.concat([iv, cipher.update(bytes), cipher.final()]);
  const malformed = await raw.save({ useObjectStreams: false, updateFieldAppearances: false });
  const native = vi.spyOn(globalThis.crypto.subtle, 'decrypt');
  const result = await unlockPdf(malformed, 'reader');
  expect(privateStream(await PDFDocument.load(result.bytes)).getContents()).toEqual(bytes);
  expect(native).toHaveBeenCalledTimes(1);
});

it('propagates native decryption failures without modifying the encrypted bytes', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  addPrivateData(doc, content());
  const saved = await protectPdf(await doc.save(), { open: 'reader' });
  const original = saved.slice();
  vi.spyOn(globalThis.crypto.subtle, 'decrypt').mockRejectedValue(
    new Error('Native decryption failed'),
  );
  await expect(unlockPdf(saved, 'reader')).rejects.toThrow('Native decryption failed');
  expect(saved).toEqual(original);
});

it('preserves recovery when an AES stream has trailing partial blocks', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = content();
  addPrivateData(doc, bytes);
  const saved = await protectPdf(await doc.save(), { open: 'reader' });
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
  const stream = privateStream(raw);
  const trailing = new Uint8Array(stream.contents.length + 3);
  trailing.set(stream.contents);
  trailing.set([1, 2, 3], stream.contents.length);
  stream.contents = trailing;
  const malformed = await raw.save({ useObjectStreams: false, updateFieldAppearances: false });
  const native = vi.spyOn(globalThis.crypto.subtle, 'decrypt');
  const opened = await unlockPdf(malformed, 'reader');
  expect(privateStream(await PDFDocument.load(opened.bytes)).getContents()).toEqual(bytes);
  expect(native).toHaveBeenCalledTimes(1);
});

for (const buffer of [false, true])
  it(`keeps CBC chaining, padding, and source ${buffer ? 'Buffer' : 'Uint8Array'} exact across native chunks`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = Uint8Array.from(
      { length: 2 * 1024 * 1024 + 3 },
      (_, i) => (i * 73 + Math.floor(i / 251)) & 255,
    );
    addPrivateData(doc, bytes);
    const protectedBytes = await protectPdf(await doc.save(), { open: 'reader' });
    const saved = buffer ? Buffer.from(protectedBytes) : protectedBytes;
    const original = new Uint8Array(saved);
    const native = vi.spyOn(globalThis.crypto.subtle, 'decrypt');
    const opened = await unlockPdf(saved, 'reader');
    const decoded = privateStream(await PDFDocument.load(opened.bytes)).getContents();
    expect(Buffer.from(decoded).equals(Buffer.from(bytes))).toBe(true);
    expect(Buffer.from(saved).equals(Buffer.from(original))).toBe(true);
    expect(native.mock.calls.length).toBeGreaterThan(1);
    for (const [, , data] of native.mock.calls)
      expect(data.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
