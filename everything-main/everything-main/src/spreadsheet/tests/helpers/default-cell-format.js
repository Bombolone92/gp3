import { otherProgramsXlsx } from './xlsx-fixture.js';

export const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export function defaultCellFormatFile({ prefix = false, fill = '<fill><patternFill patternType="solid"><fgColor rgb="FFBBDDEE"/></patternFill></fill>',
  font = '<font><b/><i/><sz val="14"/><color rgb="FF234567"/><name val="Courier New"/></font>',
  alignment = '<alignment horizontal="right" vertical="top" wrapText="1" indent="2" textRotation="105"/>',
  numFmt = 9, defaultFontId = 1, defaultFillId = 2, defaultBorderId = 1, normalFillId = 0, extra = '', head = '', rows = '<row r="1"><c r="A1" s="1"><v>0.125</v></c><c r="B1"><v>0.25</v></c></row>',
} = {}) {
  let xml = `<styleSheet xmlns="${MAIN}" xmlns:q="urn:default-format-test">`
    + `<fonts count="2"><font><sz val="11"/><name val="Arial"/></font>${font}</fonts>`
    + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill}</fills>`
    + '<borders count="2"><border/><border><bottom style="double"><color rgb="FF456789"/></bottom></border></borders>'
    + `<cellStyleXfs count="1"><xf fontId="0" fillId="${normalFillId}" borderId="0" numFmtId="0"/></cellStyleXfs>`
    + `<cellXfs count="2"><xf fontId="${defaultFontId}" fillId="${defaultFillId}" borderId="${defaultBorderId}" numFmtId="${numFmt}" xfId="0">${alignment}${extra}</xf>`
    + '<xf fontId="0" fillId="0" borderId="0" numFmtId="0" xfId="0"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" builtinId="0" xfId="0"/></cellStyles></styleSheet>';
  if (prefix) xml = xml.replace(/<(\/?)([a-zA-Z][\w]*)(?=[\s/>])/g, (_, close, name) => `<${close}s:${name}`)
    .replace(`xmlns="${MAIN}"`, `xmlns:s="${MAIN}"`);
  return otherProgramsXlsx({ sheetXml: { Data: { head, rows } }, patch: { '/xl/styles.xml': () => xml } });
}
