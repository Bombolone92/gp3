import { PDFName } from 'pdf-lib';

const VERSION = PDFName.of('Version');
const parse = (value) => (/^\d+\.\d+$/.test(value) ? value.split('.').map(Number) : [0, 0]);
const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/** The header and catalog can independently raise the minimum reader version. */
export function pdfVersion(doc) {
  const header = parse(`${doc.context.header.major}.${doc.context.header.minor}`);
  const value = doc.catalog.lookup(VERSION);
  const catalog = value instanceof PDFName ? parse(value.decodeText()) : [0, 0];
  return newer(catalog, header) ? catalog : header;
}

/** Copied pages can carry features requiring the source document's version. */
export function inheritPdfVersion(doc, source) {
  const version = pdfVersion(source);
  if (newer(version, pdfVersion(doc))) doc.catalog.set(VERSION, PDFName.of(version.join('.')));
}

/**
 * Both pdf-lib writers always emit a 1.7 header. Declare any higher requirement in the
 * catalog before saving, which works with both xref formats without patching byte offsets.
 */
export function savePdf(doc, options) {
  const version = pdfVersion(doc);
  if (newer(version, [1, 7])) doc.catalog.set(VERSION, PDFName.of(version.join('.')));
  return doc.save(options);
}
