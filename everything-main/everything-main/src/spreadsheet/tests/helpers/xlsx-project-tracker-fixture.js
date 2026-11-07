import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

/** A project plan built here with the workbook features under test. */
export function projectTrackerXlsx({ controlProps = '', caption = '', occupied = false, external = false } = {}) {
  const names = ['Project plan', 'Blank project plan'];
  const statuses = ['Not Started', 'In Progress', 'Complete', 'On Hold', 'Overdue'];
  const priorities = ['High', 'Medium', 'Low'];
  const colors = ['D9D9D9', 'FFFF00', '00B050', 'FFC000', 'FF0000', 'FF0000', 'FFFF00', '00B050'];
  const taskRows = [5, 6, 7, 8, 9, 11, 12, 13, 14, ...Array.from({ length: 13 }, (_, i) => 16 + i)];
  const sheetXml = Object.fromEntries(names.map((name, sheet) => {
    const rows = new Map();
    const cell = (col, r, value = null, style = 1) => {
      if (!rows.has(r)) rows.set(r, []);
      const body = value == null ? '' : `<v>${value}</v>`;
      rows.get(r).push(`<c r="${col}${r}" s="${style}"${typeof value === 'string' ? ' t="str"' : ''}>${body}</c>`);
    };
    cell('B', 2, 'Sample project plan', 2);
    for (const [i, title] of ['At Risk', 'Status', 'Priority', 'Deadline', 'Task'].entries()) cell(String.fromCharCode(66 + i), 4, title, 3);
    for (let i = 0; i < statuses.length; i++) cell('O', i + 5, statuses[i]);
    for (let i = 0; i < priorities.length; i++) cell('Q', i + 5, priorities[i]);
    for (const [i, r] of taskRows.entries()) {
      cell('B', r + 1, occupied && i === 0 ? 'Keep me' : null);
      cell('F', r + 1, `Task ${i + 1}`);
      if (!sheet && i < 5) {
        cell('C', r + 1, ['Complete', 'In Progress', 'Overdue', 'Not Started', 'On Hold'][i]);
        cell('D', r + 1, priorities[Math.min(2, Math.max(0, i - 2))]);
        cell('J', r + 1, [1, 0.8, 0.3, 0, 0.1][i], 4);
      }
    }
    const controlXml = taskRows.map((r, i) => `<mc:AlternateContent><mc:Choice Requires="x14"><control shapeId="${1026 + i}" r:id="check${i}" name="Check Box ${i + 1}"><controlPr><anchor moveWithCells="1"><from><xdr:col>1</xdr:col><xdr:colOff>152400</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>0</xdr:rowOff></from><to><xdr:col>1</xdr:col><xdr:colOff>482600</xdr:colOff><xdr:row>${r + 1}</xdr:row><xdr:rowOff>25400</xdr:rowOff></to></anchor></controlPr></control></mc:Choice></mc:AlternateContent>`).join('');
    const textRule = (label, i, col) => `<cfRule type="containsText" operator="containsText" text="${label}" dxfId="${i}" priority="${i + 1}"><formula>NOT(ISERROR(SEARCH("${label}",${col}5)))</formula></cfRule>`;
    return [name, {
      head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="13"/>'
        + '<cols><col min="1" max="1" width="3.33203125"/><col min="2" max="2" width="7.83203125"/><col min="3" max="5" width="12.83203125"/><col min="6" max="7" width="30.83203125"/></cols>',
      rows: [...rows].sort(([a], [b]) => a - b).map(([r, cells]) => `<row r="${r}" ht="${r === 2 ? 61 : 25}">${cells.join('')}</row>`).join(''),
      tail: '<conditionalFormatting sqref="O5:O10 C5:C29">' + statuses.map((v, i) => textRule(v, i, 'C')).join('') + '</conditionalFormatting>'
        + '<conditionalFormatting sqref="Q5:Q8 D5:D29">' + priorities.map((v, i) => textRule(v, i + 5, 'D')).join('') + '</conditionalFormatting>'
        + '<dataValidations count="2"><dataValidation type="list" sqref="C5:C29"><formula1>$O$5:$O$10</formula1></dataValidation><dataValidation type="list" sqref="D5:D29"><formula1>$Q$5:$Q$8</formula1></dataValidation></dataValidations>'
        + '<legacyDrawing r:id="legacy"/><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><mc:Choice Requires="x14"><controls>' + controlXml + '</controls></mc:Choice></mc:AlternateContent>',
    }];
  }));
  const bytes = otherProgramsXlsx({ sheetNames: names, sheetXml, styles: {
    fonts: ['<font><name val="Century Gothic"/><sz val="10"/></font>', '<font><name val="Century Gothic"/><sz val="28"/><b/></font>'],
    fills: ['<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>'],
    borders: ['<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="medium"><color rgb="FFBFBFBF"/></bottom></border>'],
    cellXfs: ['<xf fontId="1" fillId="2"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf>', '<xf fontId="2"/>', '<xf fontId="1" borderId="1"/>', '<xf fontId="1" numFmtId="9"/>'],
  }, patch: {
    '/xl/styles.xml': xml => xml.replace(/<dxfs[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/, `<dxfs count="8">${colors.map(color => `<dxf><fill><patternFill><bgColor rgb="FF${color}"/></patternFill></fill></dxf>`).join('')}</dxfs>`),
  } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  const rel = (id, kind, target, extra = '') => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}" ${extra}/>`;
  for (let sheet = 0; sheet < names.length; sheet++) {
    add(`xl/worksheets/_rels/sheet${sheet + 1}.xml.rels`, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + rel('legacy', 'vmlDrawing', `../drawings/boxes${sheet}.vml`)
      + taskRows.map((r, i) => rel(`check${i}`, 'ctrlProp', `../controls/tracker${sheet}-${i}.xml`, external && !i ? 'TargetMode="External"' : '')).join('') + '</Relationships>');
    add(`xl/drawings/boxes${sheet}.vml`, '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">'
      + taskRows.map((r, i) => `<v:shape id="_x0000_s${1026 + i}"><v:textbox><div>${i === 0 ? caption : ''}</div></v:textbox><x:ClientData ObjectType="Checkbox"/></v:shape>`).join('') + '</xml>');
    for (let i = 0; i < taskRows.length; i++) add(`xl/controls/tracker${sheet}-${i}.xml`, '<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" objectType="CheckBox"'
      + (!sheet && i === 1 ? ' checked="Checked"' : '') + (i === 0 ? ` ${controlProps}` : '') + '/>');
  }
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
