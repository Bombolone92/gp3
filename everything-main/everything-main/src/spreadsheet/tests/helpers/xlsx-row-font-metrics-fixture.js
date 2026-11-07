import { otherProgramsXlsx } from './xlsx-fixture.js';
import { xmlText } from '../../src/core/xlsx-export-styles.js';

/** Native Excel measurement control, not expected output for the app's fitter.
 * Each row isolates a family/size/line count; no label cell can set its height.
 * Cached automatic heights are deliberately too small. Literal font records
 * and a standard sheet view isolate metrics from theme and view conversion.
 */
export function rowFontMetricsXlsx({
  families = ['Arial', 'Calibri', 'Courier New', 'Georgia', 'Lucida Sans', 'Geneva', 'Times New Roman'],
  sizes = [6, 8, 9, 10, 11, 12, 14, 16, 20, 28], lineCounts = [1, 2, 3],
  fontStyles = [{}], samples = ['Ag 0123456789'],
  normal = { name: 'Arial', size: 11 },
} = {}) {
  const fonts = [], cellXfs = [], cases = [], sheetXml = {};
  for (const [index, family] of families.entries()) {
    const sheet = `${index + 1} ${family}`.replace(/[\\/?*\[\]:]/g, '-').slice(0, 31);
    let rows = '', row = 0;
    for (const size of sizes) for (const face of fontStyles) for (const sample of samples) for (const repetitions of lineCounts) {
      fonts.push(`<font><sz val="${size}"/><name val="${xmlText(family)}"/>${face.bold ? '<b/>' : ''}${face.italic ? '<i/>' : ''}</font>`);
      const style = fonts.length;
      cellXfs.push(`<xf fontId="${style}" applyFont="1" applyAlignment="1"><alignment vertical="bottom" wrapText="1"/></xf>`);
      row++;
      const value = Array(repetitions).fill(sample).join('\n');
      rows += `<row r="${row}" ht="1" customHeight="0"><c r="A${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c></row>`;
      cases.push({ sheet, row, family, size, lines: value.split('\n').length, bold: !!face.bold, italic: !!face.italic, value });
    }
    sheetXml[sheet] = {
      head: '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15" customHeight="1"/><cols><col min="1" max="1" width="70" customWidth="1"/></cols>',
      rows,
    };
  }
  const bytes = otherProgramsXlsx({ sheetNames: Object.keys(sheetXml), sheetXml, styles: { fonts, cellXfs },
    patch: { '/xl/styles.xml': xml => xml.replace('<name val="Calibri"/>', `<name val="${xmlText(normal.name)}"/>`)
      .replace('<sz val="12"/>', `<sz val="${normal.size}"/>`).replace('<scheme val="minor"/>', '') },
  });
  return { bytes, cases };
}
