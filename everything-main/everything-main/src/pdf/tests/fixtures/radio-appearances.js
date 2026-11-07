import { PDFName } from 'pdf-lib';
import { radioPagesPdf } from './radio-pages.js';

export async function incompleteRadioPdf({ missing = 0, appearance = 'missing', ...options } = {}) {
  const { doc, field } = await radioPagesPdf({ selected: 'Express', ...options });
  const widget = field.acroField.getWidgets()[missing];
  if (appearance === 'missing') widget.dict.delete(PDFName.of('AP'));
  else widget.getAppearances().normal.delete(widget.getOnValue());
  return { doc, field };
}
