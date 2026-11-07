import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
const parser = new (new JSDOM('').window.DOMParser)();
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const TC = 'http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments';
function bookFor(author, threaded) {
  const book = X.utils.book_new(), sheet = X.utils.aoa_to_sheet([['Data', 'Other']]);
  sheet.A1.c = [{ a: author, t: 'First note', ...(threaded ? { T: true } : {}) }];
  sheet.B1.c = [{ a: 'Second', t: 'Other note', ...(threaded ? { T: true } : {}) }];
  X.utils.book_append_sheet(book, sheet, 'Data'); return book;
}
const write = book => new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' }));
function part(bytes, threaded) {
  const zip = X.CFB.read(bytes, { type: 'array' });
  const entry = zip.FileIndex.find(e => e.name === (threaded ? 'person.xml' : 'comments1.xml'));
  return { zip, entry, xml: new TextDecoder().decode(entry.content) };
}
const decode = value => value.replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
it.each([false, true].flatMap(threaded => ['A & B', 'A <B> "C"', '_x0041_', '_x005F_x0041_', 'Zoë 😀', 'First\nLast\tName', 'A\r\nB', 'Plain'].map(author => ({ threaded, author }))))(
  'preserves $author with threaded=$threaded through repeated saves', ({ threaded, author }) => {
    let book = bookFor(author, threaded);
    for (let i = 0; i < 2; i++) {
      const bytes = write(book), { xml } = part(bytes, threaded), doc = parser.parseFromString(xml, 'application/xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      const names = threaded ? [...doc.getElementsByTagNameNS(TC, 'person')].map(p => decode(p.getAttribute('displayName'))) : [...doc.getElementsByTagNameNS(MAIN, 'author')].map(p => decode(p.textContent));
      expect(names).toContain(author); expect(names).toContain('Second');
      book = X.read(bytes, { type: 'array' });
      expect(book.Sheets.Data.A1.c[0]).toMatchObject({ a: author, t: 'First note' });
      expect(book.Sheets.Data.B1.c[0]).toMatchObject({ a: 'Second', t: 'Other note' });
    }
  },
);
it.each([false, true])('decodes native author escapes once with threaded=%s', threaded => {
  const { zip, entry, xml } = part(write(bookFor('SENTINEL', threaded)), threaded);
  const updated = xml.replaceAll('SENTINEL', '_x0041_ &amp; _x005F_x0042_ &#x1F600;');
  entry.content = new TextEncoder().encode(updated); entry.size = entry.content.length;
  const book = X.read(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), { type: 'array' });
  expect(book.Sheets.Data.A1.c[0].a).toBe('A & _x0042_ 😀');
});
it('ignores XML comments and decodes CDATA in native legacy authors', () => {
  const { zip, entry, xml } = part(write(bookFor('SENTINEL', false)), false);
  const updated = xml.replace('SENTINEL', '<![CDATA[A & _x0041_]]><!-- fake </author><author>bad -->');
  entry.content = new TextEncoder().encode(updated); entry.size = entry.content.length;
  const book = X.read(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), { type: 'array' });
  expect(book.Sheets.Data.A1.c[0].a).toBe('A & A'); expect(book.Sheets.Data.B1.c[0].a).toBe('Second');
});
it('normalizes raw attribute whitespace while preserving encoded whitespace in native person names', () => {
  const { zip, entry, xml } = part(write(bookFor('SENTINEL', true)), true);
  const updated = xml.replaceAll('SENTINEL', 'A\tB\r\nC_x0009_D');
  entry.content = new TextEncoder().encode(updated); entry.size = entry.content.length;
  const book = X.read(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), { type: 'array' });
  expect(book.Sheets.Data.A1.c[0].a).toBe('A B C\tD');
});
