import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// Representative layout from an Excel course planner, without personal data.
export function degreeRoadmapXlsx({ styleName = null } = {}) {
  const c = (ref, text, style = 0) => `<c r="${ref}" s="${style}" t="str"><v>${text}</v></c>`;
  const bytes = otherProgramsXlsx({
    sheetNames: ['Planning', 'Check'],
    styles: {
      fonts: ['<font><name val="Calibri"/><sz val="11"/><b/><color theme="1"/></font>', '<font><name val="Calibri"/><sz val="20"/><b/></font>'],
      fills: ['<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/></patternFill></fill>'],
      cellXfs: [
        '<xf fontId="1" fillId="2"><alignment vertical="bottom" wrapText="1"/></xf>',
        '<xf fontId="0" fillId="3"/>',
        '<xf fontId="2"/>',
        '<xf fontId="0"><alignment vertical="center" wrapText="1"/></xf>',
      ],
    },
    sheetXml: {
      Planning: {
        head: '<sheetFormatPr defaultRowHeight="15" defaultColWidth="8.83203125"/><cols><col min="1" max="1" width="30.6640625"/><col min="2" max="3" width="19.1640625"/><col min="4" max="4" width="36.83203125"/><col min="5" max="6" width="11.83203125"/></cols>',
        rows: `<row r="1" ht="41">${c('A1', 'Course Roadmap', 3)}</row>`
          + `<row r="8" ht="26.5">${c('A8', 'Review the course requirements and prerequisite order before submitting your plan.', 4)}</row>`
          + `<row r="23" ht="30.75">${['Category', 'Course Subject Prefix (e.g. ECE or PHYS)', 'Course Number (e.g. 2020 or 3710)', 'Course Title (i.e. ECE Discovery Studio)', 'Credit Hours', 'TERM CODE'].map((t, i) => c(`${String.fromCharCode(65 + i)}23`, t, 1)).join('')}</row>`
          + `<row r="24" ht="16">${c('A24', 'Core', 2)}${c('B24', 'ECE', 2)}${c('C24', '1100', 2)}${c('D24', 'Discovery Studio', 2)}<c r="E24"><v>3</v></c></row>`
          + `<row r="25">${c('A25', 'Core', 2)}<c r="E25"><v>4</v></c></row>`
          + '<row r="26"><c r="E26"><f>SUM(E24:E25)</f><v>7</v></c></row>',
        tail: '<mergeCells count="1"><mergeCell ref="A8:B12"/></mergeCells><tableParts count="1"><tablePart r:id="table"/></tableParts>',
      },
      Check: { head: '<sheetFormatPr defaultRowHeight="15"/>', rows: '<row r="1"><c r="A1"><f>Planning!E26</f><v>7</v></c></row>' },
    },
    patch: { '/xl/styles.xml': xml => xml.replace('<sz val="12"/>', '<sz val="11"/>') },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, text) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(text));
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="table" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>');
  add('xl/tables/table1.xml', '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Courses" displayName="Courses" ref="A23:F25" totalsRowShown="0">'
    + '<autoFilter ref="A23:F25">' + Array.from({ length: 6 }, (_, i) => `<filterColumn colId="${i}" hiddenButton="1"/>`).join('') + '</autoFilter>'
    + '<tableColumns count="6">' + ['Category', 'Subject', 'Number', 'Title', 'Hours', 'Term'].map((name, i) => `<tableColumn id="${i + 1}" name="${name}"/>`).join('') + '</tableColumns>'
    + `<tableStyleInfo${styleName == null ? '' : ` name="${styleName}"`} showRowStripes="1" showColumnStripes="0"/></table>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
