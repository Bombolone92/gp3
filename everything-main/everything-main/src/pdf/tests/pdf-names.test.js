import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { validatePdf } from '../src/core/document.js';
import { savePdf } from '../src/core/version.js';

/** A one-page PDF whose font resource is named with a lowercase #xx escape (#2f is '/'). */
function lowercaseEscapePdf() {
  const content = 'BT /F#2fa 24 Tf 20 40 Td (Hello) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F#2fa 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let out = '%PDF-1.7\n';
  const offsets = objects.map((object, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

it('keeps names with lowercase hex escapes pointing at their resources through a save', async () => {
  const doc = await validatePdf(lowercaseEscapePdf());
  const fonts = () => doc.getPage(0).node.Resources().lookup(PDFName.of('Font'));
  expect(
    fonts()
      .keys()
      .map((key) => key.decodeText()),
  ).toEqual(['F/a']);
  expect(fonts().get(PDFName.of('F#2fa'))).toBe(fonts().get(PDFName.of('F#2Fa')));
  const saved = await PDFDocument.load(await savePdf(doc));
  const keys = saved.getPage(0).node.Resources().lookup(PDFName.of('Font')).keys();
  expect(keys.map((key) => key.decodeText())).toEqual(['F/a']);
  expect(keys.map(String)).toEqual(['/F#2Fa']);
});
