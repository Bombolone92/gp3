import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';

const bytesOf = (text) => new TextEncoder().encode(text);

// The content sniff classed a first cell of "ID;P…" (the SYLK signature), "TABLE" (DIF), "<table",
// "<html", "<meta" or "<?xml" as markup and sent the file to the library even when it was named
// .csv, .tsv or .txt: a German price list opened with "2,50" as 250 and "Müller" as mojibake,
// and a CSV whose first cell was an HTML tag was refused or opened empty. A file with a text
// extension is delimited text unless its bytes are a zip or a compound file.
const BODY = ';Preis;Menge\n1;2,50;3\n2;"Müller, Hans";4\n07;1.234,5;x\n';

it.each(['artikel.csv', 'artikel.txt', 'ARTIKEL.CSV'])('reads a semicolon CSV whose header starts with ID;P as text when named %s', async (name) => {
  const wb = await workbookFromFile(bytesOf(`ID${BODY}`), name);
  const id = wb.activeSheetId;
  expect(wb.sheets[0].name).toBe(name.replace(/\.[^.]+$/i, ''));
  expect(wb.fitColumnsOnOpen).toEqual([id]);
  expect(wb.getValue(id, 0, 0)).toBe('ID');
  expect(wb.getValue(id, 1, 1)).toBe('2,50');
  expect(wb.getValue(id, 2, 1)).toBe('Müller, Hans');
  expect(wb.getValue(id, 3, 1)).toBe('1.234,5');
  expect(wb.getValue(id, 3, 0)).toBe(7);
  // The same bytes with another header always opened this way; both now agree cell for cell.
  const control = await workbookFromFile(bytesOf(`Nr${BODY}`), name);
  for (let r = 0; r < 4; r++) for (let c = 1; c < 3; c++) expect(wb.getValue(id, r, c)).toEqual(control.getValue(control.activeSheetId, r, c));
});

it('reads a tab-separated file whose header starts with ID<tab>P as text', async () => {
  const wb = await workbookFromFile(bytesOf('ID;Preis\tMenge\n1\t2\n'), 'x.tsv');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('ID;Preis');
  expect(wb.getValue(wb.activeSheetId, 1, 1)).toBe(2);
});

it.each([
  ['<table>,1\n2,3\n', '<table>'],
  ['<meta name="x">,1\n2,3\n', '<meta name="x">'],
  ['<html>,1\n2,3\n', '<html>'],
  ['<head>,1\n2,3\n', '<head>'],
  ['<body>,1\n2,3\n', '<body>'],
  ['<?xml version="1.0"?>,1\n2,3\n', '<?xml version="1.0"?>'],
  ['<!DOCTYPE html>,1\n2,3\n', '<!DOCTYPE html>'],
])('keeps a CSV whose first cell is %j on the text path', async (text, a1) => {
  for (const name of ['x.csv', 'x.txt', 'x.tsv']) {
    const wb = await workbookFromFile(bytesOf(text), name);
    const id = wb.activeSheetId;
    // A .tsv splits on tabs alone, so its first line is one cell.
    if (name === 'x.tsv') { expect(wb.getValue(id, 0, 0)).toBe(text.split('\n')[0]); continue; }
    expect(wb.getValue(id, 0, 0)).toBe(a1);
    expect(wb.getValue(id, 0, 1)).toBe(1);
    expect(wb.getValue(id, 1, 0)).toBe(2);
    expect(wb.getValue(id, 1, 1)).toBe(3);
  }
});

it('keeps a CSV whose first line is the word TABLE (the DIF signature) on the text path', async () => {
  const wb = await workbookFromFile(bytesOf('TABLE\n0,1\n2,3\n'), 'dif.csv');
  const id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe('TABLE');
  expect(wb.getValue(id, 1, 0)).toBe(0);
  expect(wb.getValue(id, 1, 1)).toBe(1);
  expect(wb.getValue(id, 2, 1)).toBe(3);
});
