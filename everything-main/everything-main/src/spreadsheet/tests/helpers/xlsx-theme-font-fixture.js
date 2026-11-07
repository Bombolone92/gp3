import { otherProgramsXlsx } from './xlsx-fixture.js';
import { effectiveFontTheme, fontThemeXml } from '../../src/core/font-theme.js';
export function themeFontXlsx({ minor = 'Courier New', major = 'Georgia', scheme = 'minor' } = {}) {
  const theme = effectiveFontTheme(); theme.minor.latin.typeface = minor; theme.major.latin.typeface = major;
  return otherProgramsXlsx({ sheetXml: { Data: {
    head: '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="20" defaultColWidth="12"/><cols><col min="2" max="2" width="15" style="1"/></cols>',
    rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>Minor font</t></is></c><c r="C1" s="1" t="inlineStr"><is><t>Major font</t></is></c><c r="D1" s="2" t="inlineStr"><is><t>Literal font</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><r><rPr><rFont val="Arial"/><sz val="14"/><scheme val="major"/></rPr><t>Rich heading</t></r></is></c></row>'
      + '<row r="3" s="2" customFormat="1"/><row r="4"><c r="A4"><v>17</v></c><c r="B4"><f>A4*2</f><v>34</v></c></row>',
    tail: '<conditionalFormatting sqref="A4"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>',
  } }, styles: {
    fonts: ['<font><sz val="14"/><name val="Arial"/><scheme val="major"/></font>', '<font><sz val="16"/><name val="Courier New"/><scheme val="none"/></font>'],
    cellXfs: ['<xf fontId="1"/>','<xf fontId="2"/>'],
  }, patch: {
    '/xl/styles.xml': s => s.replace('<name val="Calibri"/>','<name val="Arial"/>').replace('<sz val="12"/>','<sz val="16"/>')
      .replace('<scheme val="minor"/>', `<scheme val="${scheme}"/>`)
      .replace(/<dxfs\b[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/, '<dxfs count="1"><dxf><font><name val="Arial"/><scheme val="major"/></font></dxf></dxfs>'),
    '/xl/theme/theme1.xml': s => s.replace(/<a:fontScheme\b[^>]*>[\s\S]*?<\/a:fontScheme>/, fontThemeXml(theme)),
  } });
}
