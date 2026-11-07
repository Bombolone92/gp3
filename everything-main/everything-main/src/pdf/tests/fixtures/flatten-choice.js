import {
  PDFDocument,
  PDFName,
  PDFHexString,
  defaultDropdownAppearanceProvider,
  defaultOptionListAppearanceProvider,
} from 'pdf-lib';

export async function flattenChoicePdf({
  list = false,
  inherited = false,
  value = 'current',
} = {}) {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  const field = list
    ? form.createOptionList('Destination.Country')
    : form.createDropdown('Destination.Country');
  const options = [
    { value: 'CA', label: 'Canada' },
    { value: 'FR', label: 'France' },
    { value: 'JP', label: 'Japan' },
  ];
  field.acroField.setOptions(
    options.map(({ value, label }) => ({
      value: PDFHexString.fromText(value),
      display: PDFHexString.fromText(label),
    })),
  );
  if (list) field.enableMultiselect();
  let selected = list ? ['CA', 'JP'] : ['CA'];
  if (value === 'empty') selected = [];
  if (value === 'custom') {
    field.enableEditing();
    selected = ['Elsewhere'];
  }
  field.acroField.dict.set(PDFName.of('V'), doc.context.obj(selected.map(PDFHexString.fromText)));
  field.addToPage(doc.addPage([400, 400]), { x: 30, y: 250, width: 240, height: list ? 100 : 30 });
  const parent = field.acroField.getParent().dict;
  if (inherited) {
    for (const key of ['Opt', 'V']) {
      parent.set(PDFName.of(key), doc.context.register(field.acroField.dict.get(PDFName.of(key))));
      field.acroField.dict.delete(PDFName.of(key));
    }
  }
  const owner = inherited ? parent : field.acroField.dict;
  if (value === 'default') {
    owner.set(PDFName.of('DV'), owner.get(PDFName.of('V')));
    owner.delete(PDFName.of('V'));
  } else if (value === 'empty') {
    owner.set(PDFName.of('DV'), PDFHexString.fromText('FR'));
  }
  const labels = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  field.updateAppearances(form.getDefaultFont(), (source, widget, font) => {
    const display = Object.create(source);
    display.getSelected = () => labels;
    display.getOptions = () => options.map((o) => o.label);
    return (list ? defaultOptionListAppearanceProvider : defaultDropdownAppearanceProvider)(
      display,
      widget,
      font,
    );
  });
  return { doc, field, parent };
}
