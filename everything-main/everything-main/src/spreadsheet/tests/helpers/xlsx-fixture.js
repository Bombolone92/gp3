import * as X from '../../src/vendor/xlsx.mjs';

/**
 * An .xlsx as another program would write it: a SheetJS skeleton with the given sheet names,
 * whose worksheet parts are then replaced by hand-written XML and whose style table is
 * extended with fonts, fills, number formats and cell formats of the test's own.
 *
 *   otherProgramsXlsx({
 *     sheetNames: ['Data', 'More'],
 *     sheetXml: { Data: { head: '<sheetPr>…</sheetPr>', rows: '<row r="1">…</row>', tail: '<sheetProtection sheet="1"/>' } },
 *     styles: { fonts: ['<font><b/>…</font>'], fills: ['<fill>…</fill>'], numFmts: ['<numFmt numFmtId="164" …/>'], cellXfs: ['<xf fontId="1" …/>'] },
 *     patch: { '/xl/workbook.xml': (xml) => xml.replace(…) },
 *   })
 *
 * A sheet's `head` goes before <sheetData>, `tail` after it; a plain string stands for the
 * whole worksheet element's content. The skeleton's own style table has one font, two fills
 * (none, gray125) and one cell format, so the first added font is fontId 1, the first added
 * fill fillId 2 and the first added cell format s="1".
 */
export function otherProgramsXlsx({ sheetNames = ['Data'], sheetXml = {}, styles = null, patch = {} } = {}) {
  const book = X.utils.book_new();
  for (const name of sheetNames) X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), name);
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const get = (path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const set = (path, text) => { const f = X.CFB.find(zip, path); f.content = new TextEncoder().encode(text); f.size = f.content.length; };
  sheetNames.forEach((name, i) => {
    const xml = sheetXml[name];
    if (xml == null) return;
    const body = typeof xml === 'string' ? xml : `${xml.head || ''}<sheetData>${xml.rows || ''}</sheetData>${xml.tail || ''}`;
    set(`/xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${body}</worksheet>`);
  });
  if (styles) set('/xl/styles.xml', withStyles(get('/xl/styles.xml'), styles));
  for (const [path, fn] of Object.entries(patch)) set(path, fn(get(path)));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

/** The skeleton's style table with the given entries appended to its tables, counts kept right. */
function withStyles(xml, { numFmts = [], fonts = [], fills = [], borders = [], cellXfs = [] }) {
  const extend = (text, tag, entries) => {
    if (!entries.length) return text;
    const re = new RegExp(`<${tag} count="(\\d+)">([\\s\\S]*?)</${tag}>`);
    if (re.test(text)) return text.replace(re, (m, n, body) => `<${tag} count="${Number(n) + entries.length}">${body}${entries.join('')}</${tag}>`);
    // The skeleton may lack the table (numFmts): it goes first, as the schema orders it.
    return text.replace(/(<fonts)/, `<${tag} count="${entries.length}">${entries.join('')}</${tag}>$1`);
  };
  let out = xml;
  out = extend(out, 'numFmts', numFmts);
  out = extend(out, 'fonts', fonts);
  out = extend(out, 'fills', fills);
  out = extend(out, 'borders', borders);
  out = extend(out, 'cellXfs', cellXfs);
  return out;
}
