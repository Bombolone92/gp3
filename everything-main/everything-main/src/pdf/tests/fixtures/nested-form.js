import { PDFName, PDFHexString } from 'pdf-lib';
import { unnamedParentPdf } from './unnamed-form-parent.js';

export async function nestedFormPdf({ depth = 1 } = {}) {
  const result = await unnamedParentPdf();
  const { doc, text } = result;
  const roots = doc.getForm().acroForm.dict.lookup(PDFName.of('Fields'));
  let ref = text.acroField.dict.get(PDFName.of('Parent'));
  const index = roots.indexOf(ref);
  for (let i = 0; i < depth; i++) {
    const parent = doc.context.obj({ Kids: [ref] });
    if (i === depth - 1) parent.set(PDFName.of('T'), PDFHexString.fromText('Customer'));
    const parentRef = doc.context.register(parent);
    doc.context.lookup(ref).set(PDFName.of('Parent'), parentRef);
    ref = parentRef;
  }
  roots.set(index, ref);
  return result;
}
