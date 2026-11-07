import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';

export const invalidMediaBoxes = {
  missing: null,
  'wrong type': 'invalid',
  'nonnumeric coordinate': [0, 0, 'invalid', 792],
  'zero width': [0, 0, 0, 792],
  'zero height': [0, 0, 612, 0],
  'short array': [0, 0, 612],
};
export async function pageBoxPdf(kind, cropped = false, rotation = 0, inherited = false) {
  const doc = await PDFDocument.create(),
    page = doc.addPage([612, 792]);
  page.setRotation(degrees(rotation));
  if (cropped) page.setCropBox(36, 36, 540, 720);
  page.node.delete(PDFName.of('MediaBox'));
  const owner = inherited ? doc.catalog.Pages() : page.node;
  const value = invalidMediaBoxes[kind];
  if (value != null)
    owner.set(
      PDFName.of('MediaBox'),
      typeof value === 'string' ? PDFString.of(value) : doc.context.obj(value),
    );
  return doc.save();
}
