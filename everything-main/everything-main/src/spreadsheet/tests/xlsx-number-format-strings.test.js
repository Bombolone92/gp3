import { expect, it } from 'vitest';
import { formatValue } from '../src/core/format.js';
import { exportStyles, xmlTag } from '../src/core/xlsx-export-styles.js';
import { decodeXlsxString, encodeXlsxAttribute } from '../src/core/xlsx-string.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const skeleton = entries => `<styleSheet xmlns="${MAIN}"><numFmts count="${entries.length}">${entries.join('')}</numFmts><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="1"><xf/></cellXfs></styleSheet>`;
const formats = xml => Array.from(parseModelXml(xml).getElementsByTagNameNS(MAIN, 'numFmt'));
it.each(['0.00" _x0041_"', '0" _X00AF_ _x005F_"', '0" tab\tline\nreturn\r"', '0" \u0001 & < >"'])('encodes a newly allocated format exactly once: %j', code => {
  const styles = exportStyles(skeleton([])); const id = styles.numberFormatCode(code);
  const result = formats(styles.xml()).find(n => Number(n.getAttribute('numFmtId')) === id);
  expect(decodeXlsxString(result.getAttribute('formatCode'))).toBe(code);
});
it('interns existing escaped format codes by decoded identity without changing literal escapes', () => {
  const code = '0" _x0041_\n"';
  const styles = exportStyles(skeleton([xmlTag('numFmt', { numFmtId: 190, formatCode: encodeXlsxAttribute(code) })]));
  expect(styles.numberFormatCode(code)).toBe(190);
  expect(styles.numberFormatCode('0" A\n"')).not.toBe(190);
  expect(formats(styles.xml())).toHaveLength(2);
});

it('keeps literal escape-like text through cell copy and two native-only worksheet round trips', async () => {
  const { Workbook } = await import('../src/core/workbook.js');
  const { workbookToXlsx, workbookFromFile } = await import('../src/core/io.js');
  const X = await import('../src/vendor/xlsx.mjs');
  const code = '0.00" _x0041_ _X00AF_\n"';
  let wb = new Workbook({ sheets: [{ name: 'Formats', cells: { '0,0': { v: 2, s: { fmt: 'custom', code } } } }] });
  const id = wb.sheets[0].id;
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }), 1, 1);
  for (let pass = 0; pass < 2; pass++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/styles.xml').content);
    expect(formats(xml).filter(n => decodeXlsxString(n.getAttribute('formatCode')) === code)).toHaveLength(1);
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    for (const [r, c] of [[0, 0], [1, 1]]) {
      const cell = wb.getCell(wb.sheets[0].id, r, c);
      expect(cell.s).toMatchObject({ fmt: 'custom', code });
      expect(formatValue(cell.v, cell.s)).toBe('2.00 _x0041_ _X00AF_\n');
    }
  }
});
