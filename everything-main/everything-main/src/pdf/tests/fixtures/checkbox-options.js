import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

/** Checkbox on-state names and submitted values need not be the same. */
export async function checkboxOptionsPdf({
  inherited = false,
  indirect = false,
  separatePages = false,
  values = ['Courier', 'Pickup'],
  selected = 'A',
} = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const field = doc.getForm().createCheckBox('Delivery');
  field.addToPage(page, { x: 40, y: 200, width: 20, height: 20 });
  field.addToPage(separatePages ? doc.addPage([300, 300]) : page, {
    x: 120,
    y: 200,
    width: 20,
    height: 20,
  });
  field.acroField.getWidgets().forEach((widget, i) => {
    const state = i ? 'B' : 'A',
      appearances = widget.getAppearances().normal;
    appearances.set(PDFName.of(state), appearances.get(PDFName.of('Yes')));
    appearances.delete(PDFName.of('Yes'));
    widget.setAppearanceState(PDFName.of(state === selected ? state : 'Off'));
  });
  field.acroField.dict.set(PDFName.of('V'), PDFName.of(selected));
  const array = doc.context.obj(
    values.map((value) => (typeof value === 'string' ? PDFHexString.fromText(value) : value)),
  );
  if (indirect)
    for (let i = 0; i < array.size(); i++) array.set(i, doc.context.register(array.get(i)));
  const owner = inherited
    ? doc.context.obj({ T: PDFHexString.fromText('Shipping'), Kids: [field.ref] })
    : field.acroField.dict;
  owner.set(PDFName.of('Opt'), indirect ? doc.context.register(array) : array);
  if (inherited) {
    const ref = doc.context.register(owner);
    field.acroField.dict.set(PDFName.of('Parent'), ref);
    doc.catalog.lookup(PDFName.of('AcroForm')).set(PDFName.of('Fields'), doc.context.obj([ref]));
  }
  return { doc, field };
}

/** A group can include a widget with no usable on appearance. */
export async function incompleteCheckboxPdf(appearance, selected = 'A') {
  const { doc, field } = await checkboxOptionsPdf({ selected });
  field.addToPage(doc.getPage(0), { x: 200, y: 200, width: 20, height: 20 });
  const widget = field.acroField.getWidgets()[2];
  if (appearance === 'missing') widget.dict.delete(PDFName.of('AP'));
  else widget.getAppearances().normal.delete(PDFName.of('Yes'));
  return { doc, field };
}

/** The second page retains two choices when the first page is deleted. */
export async function checkboxDeletionPdf(options = {}) {
  const { doc, field } = await checkboxOptionsPdf({
    separatePages: true,
    selected: 'B',
    values: ['Courier', 'Pickup', 'Express'],
    ...options,
  });
  field.addToPage(doc.getPage(1), { x: 200, y: 200, width: 20, height: 20 });
  const widget = field.acroField.getWidgets()[2];
  const normal = widget.getAppearances().normal;
  normal.set(PDFName.of('C'), normal.get(PDFName.of('Yes')));
  normal.delete(PDFName.of('Yes'));
  return { doc, field };
}

/** Keep a selected default without an explicit current value, including inherited defaults. */
export function useCheckboxDefault(doc, field) {
  const dict = field.acroField.dict;
  const owner = dict.lookup(PDFName.of('Parent')) || dict;
  owner.set(PDFName.of('DV'), doc.context.register(field.acroField.V()));
  dict.delete(PDFName.of('V'));
}
