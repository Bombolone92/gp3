import { PDFHexString, PDFName } from 'pdf-lib';
import { editableChoicePdf } from './editable-choice.js';

export const ambiguousChoices = [
  ['A', 'Shared'],
  ['B', 'Shared'],
  ['C', 'Shared (A)'],
  ['D', ''],
  ['', ''],
  ['E', '(Empty option)'],
  ['NZ', 'New\nZealand'],
  ['Line\r\ncode', ''],
];

export async function ambiguousChoicePdf(options = {}) {
  const result = await editableChoicePdf(options);
  const { field } = result;
  field.acroField.setOptions(
    ambiguousChoices.map(([value, label]) => ({
      value: PDFHexString.fromText(value),
      display: PDFHexString.fromText(label),
    })),
  );
  if (options.defaultOnly) field.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText('B'));
  else field.acroField.setValues([PDFHexString.fromText('B')]);
  return result;
}
