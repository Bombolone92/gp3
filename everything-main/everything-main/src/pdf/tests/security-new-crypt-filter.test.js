import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renamedCrypt } from './fixtures/renamed-crypt.js';
import { attachmentStream } from './fixtures/encrypted-attachment.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

async function exactAttachments(bytes, password, names, payload) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password });
  try {
    const doc = await task.promise;
    const attachments = await doc.getAttachments();
    expect([...attachments.keys()].sort()).toEqual([...names].sort());
    for (const name of names)
      expect(Buffer.from(await doc.getAttachmentContent(name)).equals(Buffer.from(payload))).toBe(
        true,
      );
  } finally {
    await task.destroy();
  }
}
for (const [label, options] of [
  ['filter array', {}],
  ['single filter', { compressed: false, single: true }],
  ['indirect filters and names', { indirect: true }],
  ['shared filter parameters', { shared: true, indirect: true }],
  ['Identity exemption', { identity: true }],
  ['AES-128 source', { algorithm: 'AES-128' }],
  ['RC4 source', { algorithm: 'RC4' }],
  [
    'large native AES stream',
    { compressed: false, payload: Uint8Array.from({ length: 200003 }, (_, i) => (i * 73) & 255) },
  ],
])
  it(`keeps accepted custom Crypt ${label} readable when assigning new protection`, async () => {
    const { bytes, password, names, payload } = await renamedCrypt(options);
    await exactAttachments(bytes, password, names, payload);
    const opened = await unlockPdf(bytes, password);
    await exactAttachments(opened.bytes, undefined, names, payload);
    const original = opened.bytes.slice();
    const preserved = await protectPdf(opened.bytes, openedProtection(opened, password));
    await exactAttachments(preserved, password, names, payload);
    const changed = await protectPdf(opened.bytes, {
      open: 'replacement',
      permissions: 'new-owner',
    });
    await exactAttachments(changed, 'replacement', names, payload);
    await exactAttachments(changed, 'new-owner', names, payload);
    expect(Buffer.from(opened.bytes).equals(Buffer.from(original))).toBe(true);
    if (options.shared) {
      const raw = await PDFDocument.load(changed, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      const params = attachmentStream(raw, 2).dict.lookup(PDFName.of('DecodeParms')).lookup(0);
      expect(params.lookup(PDFName.of('Name'))).toBe(PDFName.of('LegacyCF'));
      expect(params.lookup(PDFName.of('Extra')).asNumber()).toBe(42);
    }
  });
