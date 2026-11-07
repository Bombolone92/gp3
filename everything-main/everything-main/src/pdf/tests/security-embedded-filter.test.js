import { expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { attachmentStream, encryptedAttachment } from './fixtures/encrypted-attachment.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

async function independentAttachment(bytes, password) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password });
  try {
    const doc = await task.promise;
    const attachments = await doc.getAttachments();
    expect([...attachments.keys()]).toEqual(['private.txt']);
    return new Uint8Array(await doc.getAttachmentContent('private.txt'));
  } finally {
    await task.destroy();
  }
}
function exact(actual, expected) {
  expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
}

for (const [label, options] of [
  ['AES-256 embedded default', {}],
  ['AES-128 embedded default', { algorithm: 'AES-128' }],
  ['RC4 embedded default', { algorithm: 'RC4' }],
  ['Identity embedded default over encrypted streams', { eff: 'Identity', stream: 'StdCF' }],
  ['indirect embedded default', { indirect: true }],
  ['missing embedded default with encrypted streams', { eff: null, stream: 'StdCF' }],
  ['missing embedded default with clear streams', { eff: null }],
  ['explicit Identity over encrypted embedded default', { crypt: 'Identity' }],
  ['explicit AES over clear embedded default', { eff: 'Identity', crypt: 'StdCF' }],
])
  it(`retains attachments for ${label} on opening, protected export, and unprotected export`, async () => {
    const { bytes, payload, password } = await encryptedAttachment(options);
    exact(await independentAttachment(bytes, password), payload);
    const original = bytes.slice();
    const opened = await unlockPdf(bytes, password);
    exact(await independentAttachment(opened.bytes), payload);
    exact(bytes, original);
    const saved = await protectPdf(opened.bytes, openedProtection(opened, password));
    exact(await independentAttachment(saved, password), payload);
    exact(await independentAttachment(saved, 'owner'), payload);
    const ordinary = await PDFDocument.load(opened.bytes);
    exact(await independentAttachment(await ordinary.save()), payload);
    exact(
      await independentAttachment(
        await protectPdf(opened.bytes, { open: 'replacement', permissions: 'new-owner' }),
        'replacement',
      ),
      payload,
    );
  });

for (const algorithm of ['AES-256', 'AES-128', 'RC4'])
  it(`uses the correct ${algorithm} path for large embedded defaults and encrypts them again on export`, async () => {
    const payload = Uint8Array.from({ length: 200003 }, (_, i) => (i * 73) & 255);
    const { bytes, password } = await encryptedAttachment({
      payload,
      compressed: false,
      algorithm,
    });
    exact(await independentAttachment(bytes, password), payload);
    const native = vi.spyOn(crypto.subtle, 'decrypt');
    try {
      const opened = await unlockPdf(bytes, password);
      expect(native.mock.calls.length).toBe(algorithm === 'RC4' ? 0 : 1);
      exact(await independentAttachment(opened.bytes), payload);
      const exported = await protectPdf(opened.bytes, openedProtection(opened, password));
      const raw = await PDFDocument.load(exported, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      expect(Buffer.from(attachmentStream(raw).getContents()).equals(Buffer.from(payload))).toBe(
        false,
      );
      exact(await independentAttachment(exported, password), payload);
    } finally {
      native.mockRestore();
    }
  });

it('can decrypt and re-encrypt legacy embedded defaults without Web Crypto', async () => {
  const { bytes, password, payload } = await encryptedAttachment({
    algorithm: 'AES-128',
    compressed: false,
    payload: new Uint8Array(200003),
  });
  const random = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues: random });
  try {
    const opened = await unlockPdf(bytes, password);
    exact(await independentAttachment(opened.bytes), payload);
    exact(
      await independentAttachment(
        await protectPdf(opened.bytes, openedProtection(opened, password)),
        password,
      ),
      payload,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it('encrypts fresh attachments using the original embedded-file cipher instead of leaving plaintext', async () => {
  const { bytes, password, payload } = await encryptedAttachment();
  const { encryption } = await unlockPdf(bytes, password);
  const doc = await PDFDocument.create();
  doc.addPage();
  await doc.attach(payload, 'private.txt');
  await doc.flush();
  const encoded = attachmentStream(doc).getContents().slice();
  const saved = await protectPdf(await doc.save(), { original: encryption });
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
  expect(Buffer.from(attachmentStream(raw).getContents()).equals(Buffer.from(encoded))).toBe(false);
  exact(await independentAttachment(saved, password), payload);
});

it('rejects an unsupported embedded-file cipher instead of returning corrupt attachment data', async () => {
  const { bytes, password } = await encryptedAttachment();
  const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const encrypt = raw.context.lookup(raw.context.trailerInfo.Encrypt);
  encrypt
    .lookup(PDFName.of('CF'))
    .set(PDFName.of('Unsupported'), raw.context.obj({ CFM: 'Unsupported' }));
  encrypt.set(PDFName.of('EFF'), PDFName.of('Unsupported'));
  const input = await raw.save({ useObjectStreams: false, updateFieldAppearances: false });
  await expect(unlockPdf(input, password)).rejects.toThrow(
    'This PDF uses an encryption method this app cannot open.',
  );
});
