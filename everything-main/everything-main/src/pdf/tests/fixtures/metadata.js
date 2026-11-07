import { PDFName } from 'pdf-lib';

export const infoDetails = {
  title: 'Info title',
  author: 'Grace',
  subject: 'Info summary',
  keywords: 'info, tags',
};
export const xmpDetails = {
  title: 'XMP title',
  author: 'Ada',
  subject: 'XMP summary',
  keywords: 'xmp, tags',
};
/** Conflicting metadata with an explicitly dated source, including an unmapped custom value. */
export function addMetadata(doc, { info = true, xmpYear = 2021, malformed = false } = {}) {
  if (info) {
    doc.setTitle(infoDetails.title);
    doc.setAuthor(infoDetails.author);
    doc.setSubject(infoDetails.subject);
    doc.setKeywords([infoDetails.keywords]);
  }
  doc.setProducer('Original PDF writer');
  doc.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  const xml = malformed
    ? '<broken>'
    : `<x:xmpmeta xmlns:x="adobe:ns:meta/">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:custom="https://example.com/metadata/">
        <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmpDetails.title}</rdf:li></rdf:Alt></dc:title>
        <dc:creator><rdf:Seq><rdf:li>${xmpDetails.author}</rdf:li></rdf:Seq></dc:creator>
        <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmpDetails.subject}</rdf:li></rdf:Alt></dc:description>
        <pdf:Keywords>${xmpDetails.keywords}</pdf:Keywords>
        <xmp:MetadataDate>${xmpYear}-01-01T00:00:00Z</xmp:MetadataDate>
        <custom:reference>record-123</custom:reference>
      </rdf:Description>
    </rdf:RDF></x:xmpmeta>`;
  doc.catalog.set(
    PDFName.of('Metadata'),
    doc.context.register(
      doc.context.stream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' }),
    ),
  );
  return xml;
}

export function addCompressiblePage(doc) {
  const page = doc.addPage([300, 400]);
  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(doc.context.stream('q Q\n'.repeat(10000))),
  );
  return page;
}
