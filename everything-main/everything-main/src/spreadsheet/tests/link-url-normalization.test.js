import { expect, it } from 'vitest';
import { Workbook, normalizeUrl, safeLinkUrl, textUrl } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const urls = [
  'mailto:user@example.com', 'MAILTO:User@example.com',
  'mailto:user_x0041_@example.com?subject=Hello%20world',
  'https://example.com/?to=user@example.com', 'http://user@example.com/path',
  'ftp://user@example.com/file', 'https://example.com/#user@example.com',
];

it.each(['#user@example.com', '#user!tag@example.com'])('keeps automatic email detection for %s', (email) => {
  expect(textUrl(email)).toBe(`mailto:${email}`);
  const wb = new Workbook();
  wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: email } }]);
  expect(wb.linkAt(wb.activeSheetId, 0, 0)).toEqual({ url: `mailto:${email}`, label: email });
});

it.each(urls)('preserves explicit URL schemes when the address contains @: %s', async (url) => {
  expect(normalizeUrl(` ${url} `)).toBe(url);
  expect(textUrl(url)).toBe(url);
  expect(safeLinkUrl(url)).toBe(url);
  let wb = new Workbook();
  wb.setCells(wb.activeSheetId, [
    { r: 0, c: 0, cell: { v: url } },
    { r: 1, c: 0, cell: { f: `HYPERLINK("${url}","Open")` } },
  ]);
  for (let round = 0; round < 2; ++round) {
    expect(wb.linkAt(wb.activeSheetId, 0, 0)).toEqual({ url, label: url });
    expect(wb.linkAt(wb.activeSheetId, 1, 0)).toEqual({ url, label: 'Open' });
    wb = await workbookFromFile(await workbookToXlsx(wb), 'links.xlsx');
  }
});

it.each(['Data@example.com', 'User@domain.org'])('preserves explicit workbook locations containing @: %s', (name) => {
  const wb = new Workbook();
  wb.renameSheet(wb.activeSheetId, name);
  const url = `#'${name}'!B2`;
  expect(normalizeUrl(url)).toBe(url);
  expect(safeLinkUrl(url)).toBe(url);
  expect(textUrl(url)).toBeNull();
  wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { f: `HYPERLINK("${url}","Jump")` } }]);
  expect(wb.linkAt(wb.activeSheetId, 0, 0)).toEqual({ url, label: 'Jump' });
  expect(wb.resolveLink(url)).toMatchObject({ sheetId: wb.activeSheetId, range: { r1: 1, c1: 1, r2: 1, c2: 1 } });
});

it.each(['custom:user@example.com', 'javascript:user@example.com', 'data:user@example.com', 'file:user@example.com'])(
  'does not relabel an unsupported URI scheme as an email address: %s', (url) => {
    expect(normalizeUrl(url)).toBe(url);
    expect(textUrl(url)).toBeNull();
    expect(safeLinkUrl(url)).toBeNull();
    const wb = new Workbook();
    wb.setCells(wb.activeSheetId, [
      { r: 0, c: 0, cell: { v: url } }, { r: 1, c: 0, cell: { f: `HYPERLINK("${url}","Open")` } },
    ]);
    expect(wb.linkAt(wb.activeSheetId, 0, 0)).toBeNull();
    expect(wb.linkAt(wb.activeSheetId, 1, 0)).toBeNull();
  },
);

it.each(['user@example.com', 'first.last+tag@example.co.uk', 'user/name@example.com'])(
  'continues recognizing bare email addresses: %s', (email) => {
    expect(normalizeUrl(email)).toBe(`mailto:${email}`);
    expect(textUrl(email)).toBe(`mailto:${email}`);
    expect(safeLinkUrl(email)).toBe(`mailto:${email}`);
  },
);

it.each([
  ['www.example.com/?to=user@example.com', 'https://www.example.com/?to=user@example.com'],
  ['example.com/path', 'https://example.com/path'],
  ['https://example.com/path', 'https://example.com/path'],
])('continues normalizing ordinary web addresses: %s', (input, expected) => {
  expect(normalizeUrl(input)).toBe(expected);
  expect(safeLinkUrl(input)).toBe(expected);
});

it.each(['mailto:user@exam\tple.com', 'https://example.com/\nuser@example.com'])(
  'continues rejecting control characters in explicit links: %j', (url) => {
    expect(textUrl(url)).toBeNull();
    expect(safeLinkUrl(url)).toBeNull();
  },
);
