import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { isZip, parseXlsx, readTabularFile } from '../src/lib/xlsx.js';
import {
  CLIENT_FIELDS, INVOICE_FIELDS, LINE_ITEM_FIELDS, guessMapping, prepareClients, prepareInvoices, prepareLineItems,
} from '../src/lib/import-csv.js';

/* A minimal ZIP writer for fixtures: method 0 (stored) by default, method 8
   (real deflate) on request. CRCs are zero — the reader trusts the XML to
   refuse garbage, exactly as it must for a truncated real file. */
function zip(entries) {
  const enc = new TextEncoder();
  const out = [];
  const central = [];
  let offset = 0;
  const p16 = (arr, v) => arr.push(v & 0xff, (v >> 8) & 0xff);
  const p32 = (arr, v) => arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  for (const [name, content, method = 0] of entries) {
    const nameB = enc.encode(name);
    const plain = enc.encode(content);
    const data = method === 8 ? new Uint8Array(deflateRawSync(plain)) : plain;
    const local = [0x50, 0x4b, 0x03, 0x04];
    p16(local, 20); p16(local, 0); p16(local, method); p16(local, 0); p16(local, 0);
    p32(local, 0); p32(local, data.length); p32(local, plain.length);
    p16(local, nameB.length); p16(local, 0);
    central.push({ nameB, method, comp: data.length, uncomp: plain.length, offset });
    out.push(...local, ...nameB, ...data);
    offset += local.length + nameB.length + data.length;
  }
  const cdStart = offset;
  for (const e of central) {
    const h = [0x50, 0x4b, 0x01, 0x02];
    p16(h, 20); p16(h, 20); p16(h, 0); p16(h, e.method); p16(h, 0); p16(h, 0);
    p32(h, 0); p32(h, e.comp); p32(h, e.uncomp);
    p16(h, e.nameB.length); p16(h, 0); p16(h, 0); p16(h, 0); p16(h, 0);
    p32(h, 0); p32(h, e.offset);
    out.push(...h, ...e.nameB);
    offset += h.length + e.nameB.length;
  }
  const eocd = [0x50, 0x4b, 0x05, 0x06];
  p16(eocd, 0); p16(eocd, 0); p16(eocd, central.length); p16(eocd, central.length);
  p32(eocd, offset - cdStart); p32(eocd, cdStart); p16(eocd, 0);
  out.push(...eocd);
  return Uint8Array.from(out);
}

/* The workbook's first tab deliberately lives in sheet2.xml, so a reader
   that shortcuts to sheet1.xml gets the wrong sheet and fails the test. */
const WORKBOOK = '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + '<sheets><sheet name="Time" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>';
const RELS = '<?xml version="1.0"?><Relationships>'
  + '<Relationship Id="rId2" Target="worksheets/sheet1.xml"/>'
  + '<Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>';
const SST = '<?xml version="1.0"?><sst count="6" uniqueCount="6">'
  + '<si><t>Timekeeper</t></si><si><t>Hours</t></si><si><t>Description</t></si><si><t>Rate</t></si>'
  + '<si><r><rPr/><t>J. </t></r><r><t>Smith</t></r></si>'          // rich text reads as one string
  + '<si><t xml:space="preserve">Paralegal review</t></si></sst>';
const SHEET = '<?xml version="1.0"?><worksheet><sheetData>'
  + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
  // Shared string, plain number, inline string with an entity, float noise,
  // and a spilled fifth column the header's width must cut.
  + '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>3.5</v></c>'
  + '<c r="C2" t="inlineStr"><is><t>Drafted &amp; filed</t></is></c>'
  + '<c r="D2"><v>1234.5599999999999</v></c><c r="E2"><v>9</v></c></row>'
  // A sparse row: B3 and C3 do not exist in the XML at all.
  + '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="D3"><v>95</v></c></row>'
  // An empty row is not a record, like a blank CSV line.
  + '<row r="4"/><row r="5"><c r="A5" t="s"><v></v></c></row>'
  // Cells without their own references follow their neighbour.
  + '<row r="6"><c t="b"><v>1</v></c><c><v>2</v></c></row>'
  + '</sheetData></worksheet>';

const workbook = (over = {}) => zip(Object.entries({
  '[Content_Types].xml': '<Types/>',
  'xl/workbook.xml': WORKBOOK,
  'xl/_rels/workbook.xml.rels': RELS,
  'xl/sharedStrings.xml': SST,
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': SHEET,
  ...over,
}));

describe('parseXlsx', () => {
  it('reads the first sheet into the shape parseCsv produces', async () => {
    const { header, rows } = await parseXlsx(workbook());
    expect(header).toEqual(['Timekeeper', 'Hours', 'Description', 'Rate']);
    expect(rows).toEqual([
      ['J. Smith', '3.5', 'Drafted & filed', '1234.56'],
      ['Paralegal review', '', '', '95'],
      ['TRUE', '2', '', ''],
    ]);
  });

  it('reads deflated entries — what Excel actually writes', async () => {
    const bytes = zip([
      ['xl/workbook.xml', WORKBOOK, 8],
      ['xl/_rels/workbook.xml.rels', RELS, 8],
      ['xl/sharedStrings.xml', SST, 8],
      ['xl/worksheets/sheet2.xml', SHEET, 8],
    ]);
    const { header, rows } = await parseXlsx(bytes);
    expect(header).toEqual(['Timekeeper', 'Hours', 'Description', 'Rate']);
    expect(rows[0]).toEqual(['J. Smith', '3.5', 'Drafted & filed', '1234.56']);
  });

  it('lets a self-closing blank cell keep its neighbours’ values', async () => {
    // Excel writes every blank cell that carries a border, fill or format as
    // <c r="A2" s="1"/>; a greedy tag pattern ran on to the next cell's
    // closing tag and moved that cell's value one column left — under the
    // blank cell's own style, so a quantity read as a date in 1900.
    const sst = '<sst><si><t>Name</t></si><si><t>Qty</t></si><si><t>Rate</t></si><si><t>Alice</t></si><si><t>Bob</t></si>'
      + '<si><r><t xml:space="preserve"/></r><r><t>A</t></r></si></sst>';   // an empty run must not swallow the next
    const sheet = '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" s="1"/><c r="B2"><v>3</v></c><c r="C2"><v>100</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="1" /><c r="C3" t="s"><v>4</v></c></row>'
      + '<row r="4" s="1" customFormat="1"/><row r="5"><c r="A5" t="s"><v>5</v></c><c r="B5"><v>2</v></c></row>'
      + '</sheetData></worksheet>';
    const { header, rows } = await parseXlsx(zip([
      ['xl/workbook.xml', WORKBOOK], ['xl/_rels/workbook.xml.rels', RELS],
      ['xl/styles.xml', '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>'],
      ['xl/sharedStrings.xml', sst], ['xl/worksheets/sheet2.xml', sheet],
    ]));
    expect(header).toEqual(['Name', 'Qty', 'Rate']);
    expect(rows).toEqual([['', '3', '100'], ['Alice', '', 'Bob'], ['A', '2', '']]);
  });

  it('reads the first visible sheet, as Excel opens on it, not a hidden one listed first', async () => {
    const bytes = zip([
      ['xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + '<sheet name="Lookups" sheetId="1" state="hidden" r:id="rId1"/>'
        + '<sheet name="Invoices" sheetId="2" r:id="rId2"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row><c t="inlineStr"><is><t>HIDDEN</t></is></c></row></sheetData></worksheet>'],
      ['xl/worksheets/sheet2.xml', '<worksheet><sheetData><row><c t="inlineStr"><is><t>Number</t></is></c></row><row><c><v>7</v></c></row></sheetData></worksheet>'],
    ]);
    const { header, rows } = await parseXlsx(bytes);
    expect(header).toEqual(['Number']);
    expect(rows).toEqual([['7']]);
  });

  it('falls back to sheet1.xml when the rels cannot be resolved', async () => {
    const bytes = zip([
      ['xl/workbook.xml', '<workbook><sheets><sheet name="Only" sheetId="1"/></sheets></workbook>'],
      ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row><c t="inlineStr"><is><t>Header</t></is></c></row><row><c><v>7</v></c></row></sheetData></worksheet>'],
    ]);
    const { header, rows } = await parseXlsx(bytes);
    expect(header).toEqual(['Header']);
    expect(rows).toEqual([['7']]);
  });

  it('refuses a ZIP that is not a workbook, and a workbook with no sheet', async () => {
    await expect(parseXlsx(zip([['mimetype', 'application/epub+zip']]))).rejects.toThrow();
    await expect(parseXlsx(zip([['xl/workbook.xml', WORKBOOK]]))).rejects.toThrow();
    await expect(parseXlsx(Uint8Array.from([1, 2, 3, 4]))).rejects.toThrow();
  });
});

/* readTabularFile takes what the picker hands over; a plain object with the
   same surface stands in for a File. */
const fakeFile = (name, data) => ({
  name,
  arrayBuffer: async () => (typeof data === 'string' ? new TextEncoder().encode(data) : data).buffer,
});

describe('readTabularFile', () => {
  it('routes CSV text to the CSV parser', async () => {
    const result = await readTabularFile(fakeFile('lines.csv', 'Description,Qty\nWork,2\n'));
    expect(result.problem).toBeUndefined();
    expect(result.header).toEqual(['Description', 'Qty']);
    expect(result.rows).toEqual([['Work', '2']]);
  });

  it('reads an .xlsx workbook directly', async () => {
    const result = await readTabularFile(fakeFile('time.xlsx', workbook()));
    expect(result.problem).toBeUndefined();
    expect(result.header).toEqual(['Timekeeper', 'Hours', 'Description', 'Rate']);
  });

  it('names the formats that need a different export', async () => {
    // Old binary Office opens with D0 CF 11 E0.
    const xls = await readTabularFile(fakeFile('old.xls', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0])));
    expect(xls.problem).toContain('.xls');
    // A Numbers document is a ZIP, so the name is the only early tell.
    const numbers = await readTabularFile(fakeFile('sheet.numbers', zip([['Index/Document.iwa', 'x']])));
    expect(numbers.problem).toContain('Numbers');
    // A ZIP that is not a workbook at all.
    const epub = await readTabularFile(fakeFile('book.epub', zip([['mimetype', 'application/epub+zip']])));
    expect(epub.problem).toContain('workbook');
    // Binary garbage is refused as a format, not mapped as garbled columns.
    const junk = await readTabularFile(fakeFile('image.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe])));
    expect(junk.problem).toBeTruthy();
  });

  it('reads a Windows code-page CSV as the text it holds', async () => {
    // What Windows Excel's plain "CSV (Comma delimited)" writes: one byte per
    // character, 0xFC for the u-umlaut, 0xE9 for the e-acute.
    const latin1 = Uint8Array.from('Name,Email\nM\xfcller GmbH,m@x.de\nCaf\xe9 Ren\xe9,c@x.fr\n', (c) => c.charCodeAt(0));
    const result = await readTabularFile(fakeFile('clients.csv', latin1));
    expect(result.problem).toBeUndefined();
    expect(result.rows).toEqual([['Müller GmbH', 'm@x.de'], ['Café René', 'c@x.fr']]);
    // A UTF-8 file that really carries a replacement character is left as it is.
    const utf8 = new TextEncoder().encode('Name,Email\nM\ufffdller,m@x.de\n');
    expect((await readTabularFile(fakeFile('c.csv', utf8))).rows).toEqual([['M\ufffdller', 'm@x.de']]);
  });

  it('trusts the bytes over a misleading name', async () => {
    // A workbook renamed .csv still reads as a workbook (isZip sees it).
    const result = await readTabularFile(fakeFile('export.csv', workbook()));
    expect(result.header).toEqual(['Timekeeper', 'Hours', 'Description', 'Rate']);
    expect(isZip(workbook())).toBe(true);
  });

  it('feeds the same mapping and plan the CSV path uses', async () => {
    const { header, rows } = await readTabularFile(fakeFile('time.xlsx', workbook()));
    const mapping = guessMapping(header, LINE_ITEM_FIELDS);
    expect(mapping).toEqual({ name: 0, details: 2, qty: 1, rate: 3 });
    const plan = prepareLineItems(rows, mapping);
    expect(plan.items.map(({ data }) => data)).toEqual([
      { name: 'J. Smith', qty: 3.5, rate: 1234.56, details: 'Drafted & filed' },
      { name: 'Paralegal review', qty: 1, rate: 95 },
      { name: 'TRUE', qty: 2, rate: '' },
    ]);
    expect(plan.errors).toEqual([]);
  });
});

/* Excel stores a date as a serial day count and a percentage as a fraction;
   only the cell's style says how it displays. styles.xml carries the custom
   format codes and the cellXfs table a cell's s="…" indexes into. */
const STYLES = '<styleSheet><numFmts count="6">'
  + '<numFmt numFmtId="164" formatCode="d\\-mmm\\-yy"/>'
  + '<numFmt numFmtId="165" formatCode="0.0%"/>'
  + '<numFmt numFmtId="166" formatCode="0.0&quot; hrs&quot;"/>'                   // quoted h is text, not hours
  + '<numFmt numFmtId="167" formatCode="$#,##0.00_);[Red]($#,##0.00)"/>'          // money stays a number
  + '<numFmt numFmtId="168" formatCode="[$-409]dddd, mmmm dd, yyyy"/>'            // locale prefix is not a token
  + '<numFmt numFmtId="169" formatCode="[h]:mm"/>'                                 // elapsed time
  + '</numFmts><cellXfs count="12">'
  + '<xf numFmtId="0"/>'                                                            // 0: General
  + '<xf numFmtId="14" applyNumberFormat="1"/>'                                     // 1: m/d/yyyy
  + '<xf numFmtId="9"/>'                                                            // 2: 0%
  + '<xf numFmtId="22"><alignment horizontal="right"/></xf>'                        // 3: m/d/yyyy h:mm
  + '<xf numFmtId="20"/>'                                                           // 4: h:mm
  + '<xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/>'                  // 5, 6, 7
  + '<xf numFmtId="167"/><xf numFmtId="168"/><xf numFmtId="169"/>'                  // 8, 9, 10
  + '<xf numFmtId="4"/>'                                                            // 11: #,##0.00
  + '</cellXfs></styleSheet>';

const styledSheet = (cells) => '<worksheet><sheetData><row r="1">'
  + cells.map((_, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>H${i}</t></is></c>`).join('')
  + '</row><row r="2">'
  + cells.map(([v, s], i) => `<c r="${String.fromCharCode(65 + i)}2"${s === undefined ? '' : ` s="${s}"`}><v>${v}</v></c>`).join('')
  + '</row></sheetData></worksheet>';

const styled = (cells, workbookXml = WORKBOOK) => zip([
  ['xl/workbook.xml', workbookXml],
  ['xl/_rels/workbook.xml.rels', RELS],
  ['xl/styles.xml', STYLES],
  ['xl/worksheets/sheet2.xml', styledSheet(cells)],
]);

describe('number formats', () => {
  it('reads a date-styled serial as the date the cell shows', async () => {
    // 45901 is 1 Sep 2025; the fraction is noon.
    const { rows } = await parseXlsx(styled([
      ['45901', 1], ['45901.5', 3], ['45901', 5], ['45901', 9], ['45901', 0], ['45901', 11], ['45901'],
      ['45901.9999999', 3],   // rounds to midnight — of the next day, as Excel shows it
    ]));
    expect(rows[0]).toEqual([
      '2025-09-01', '2025-09-01 12:00', '2025-09-01', '2025-09-01', '45901', '45901', '45901',
      '2025-09-02 00:00',
    ]);
  });

  it('reads a percent-styled fraction as the percentage, and a time as a clock reading', async () => {
    const { rows } = await parseXlsx(styled([
      ['0.2', 2], ['0.07500000000000001', 6], ['0.5', 4], ['0.354166666', 10], ['8.5', 7], ['1250', 8],
    ]));
    expect(rows[0]).toEqual(['20', '7.5', '12:00', '08:30', '8.5', '1250']);
  });

  it('follows the workbook’s 1904 date system, and leaves an impossible serial alone', async () => {
    const wb1904 = WORKBOOK.replace('<sheets>', '<workbookPr date1904="1"/><sheets>');
    const { rows } = await parseXlsx(styled([['44439', 1], ['-5', 1], ['9999999', 1]], wb1904));
    expect(rows[0]).toEqual(['2025-09-01', '-5', '9999999']);
  });

  it('reads without a styles part at all', async () => {
    const { rows } = await parseXlsx(zip([
      ['xl/workbook.xml', WORKBOOK],
      ['xl/_rels/workbook.xml.rels', RELS],
      ['xl/worksheets/sheet2.xml', styledSheet([['45901', 1], ['0.2', 2]])],
    ]));
    expect(rows[0]).toEqual(['45901', '0.2']);
  });

  it('lets the invoice wizard import a sheet whose dates are real Excel dates', async () => {
    const sheet = '<worksheet><sheetData><row r="1">'
      + '<c r="A1" t="inlineStr"><is><t>Number</t></is></c><c r="B1" t="inlineStr"><is><t>Client</t></is></c>'
      + '<c r="C1" t="inlineStr"><is><t>Issue date</t></is></c><c r="D1" t="inlineStr"><is><t>Due date</t></is></c>'
      + '<c r="E1" t="inlineStr"><is><t>Total</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>INV-7</t></is></c><c r="B2" t="inlineStr"><is><t>Acme</t></is></c>'
      + '<c r="C2" s="1"><v>45901</v></c><c r="D2" s="5"><v>45931</v></c><c r="E2" s="8"><v>1250</v></c></row>'
      + '</sheetData></worksheet>';
    const bytes = zip([
      ['xl/workbook.xml', WORKBOOK], ['xl/_rels/workbook.xml.rels', RELS],
      ['xl/styles.xml', STYLES], ['xl/worksheets/sheet2.xml', sheet],
    ]);
    const { header, rows } = await readTabularFile(fakeFile('open.xlsx', bytes));
    const plan = prepareInvoices(rows, guessMapping(header, INVOICE_FIELDS), {
      clients: [], settings: { currency: 'USD' }, existingNumbers: new Set(),
    });
    expect(plan.errors).toEqual([]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].doc.issueDate).toBe('2025-09-01');
    expect(plan.create[0].doc.dueDate).toBe('2025-10-01');
  });

  it('lets a client sheet’s percent-styled tax rate import as the percentage', async () => {
    const sheet = '<worksheet><sheetData><row r="1">'
      + '<c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Tax rate</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>Acme</t></is></c><c r="B2" s="2"><v>0.2</v></c></row>'
      + '</sheetData></worksheet>';
    const bytes = zip([
      ['xl/workbook.xml', WORKBOOK], ['xl/_rels/workbook.xml.rels', RELS],
      ['xl/styles.xml', STYLES], ['xl/worksheets/sheet2.xml', sheet],
    ]);
    const { header, rows } = await readTabularFile(fakeFile('clients.xlsx', bytes));
    const plan = prepareClients(rows, guessMapping(header, CLIENT_FIELDS), []);
    expect(plan.errors).toEqual([]);
    expect(plan.create[0].data.taxRate).toBe('20');
  });
});
