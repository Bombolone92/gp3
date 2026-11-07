import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const parser = new (new JSDOM('').window.DOMParser)();
const NS = 'http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments';
function exported(texts) {
  const book = X.utils.book_new(), sheet = X.utils.aoa_to_sheet([['Data']]);
  sheet.A1.c = texts.map((t, i) => ({ a: `Person ${i}`, t, T: true }));
  X.utils.book_append_sheet(book, sheet, 'Data');
  return new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' }));
}
function contents(bytes) {
  const zip = X.CFB.read(bytes, { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/threadedComments/threadedComment1.xml');
  return { zip, entry, xml: new TextDecoder().decode(entry.content) };
}
function native(text, { empty = false, before = '' } = {}) {
  const { zip, entry, xml } = contents(exported(['SENTINEL']));
  const content = xml.replace('<text>SENTINEL</text>', () => before + (empty ? '<text/>' : `<text>${text}</text>`));
  entry.content = new TextEncoder().encode(content); entry.size = entry.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
it.each(['A & B', '<tag> & "quotes"', '_x0041_ _X00aF_', '_x005F_x0041_', '😀 &amp; &#65;', '</text><threadedComment ref="Z99"><text>injected', 'line\r\n_x000D_\ttab', 'Plain text'])(
  'exports valid XML and preserves threaded text %j', async value => {
    let bytes = exported([value, 'Reply & ' + value]);
    for (let i = 0; i < 2; i++) {
      const { xml } = contents(bytes), doc = parser.parseFromString(xml, 'application/xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      const comments = [...doc.getElementsByTagNameNS(NS, 'threadedComment')]; expect(comments).toHaveLength(2);
      expect(comments[1].getAttribute('parentId')).toBe(comments[0].getAttribute('id'));
      const texts = [...doc.getElementsByTagNameNS(NS, 'text')].map(n => n.textContent.replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
      expect(texts).toEqual([value, 'Reply & ' + value]);
      const raw = X.read(bytes, { type: 'array' });
      expect(raw.Sheets.Data.A1.c.map(c => c.t)).toEqual([value, 'Reply & ' + value]);
      expect(raw.Sheets.Data.Z99).toBeUndefined();
      bytes = new Uint8Array(X.write(raw, { type: 'array', bookType: 'xlsx' }));
    }
  },
);
it.each([
  ['A &amp; B &lt;tag&gt;', 'A & B <tag>'], ['_x0041_ &amp; _x005F_x0042_', 'A & _x0042_'],
  ['&#x1F600; &#65; &amp;#65;', '😀 A &#65;'], ['a\r\nb\rc', 'a\nb\nc'], ['a_x000D_b', 'a\rb'],
  ['<![CDATA[_x0041_ &amp; <tag>]]>', 'A &amp; <tag>'],
  ['before<!-- <text>fake</text> -->after', 'beforeafter'], ['before<?custom ignore?>after', 'beforeafter'],
])('decodes native threaded text %j exactly once', (text, expected) => {
  const raw = X.read(native(text), { type: 'array' });
  expect(raw.Sheets.Data.A1.c).toHaveLength(1); expect(raw.Sheets.Data.A1.c[0]).toMatchObject({ t: expected, T: true });
});
it('preserves explicitly empty native threaded text', () => {
  const raw = X.read(native('', { empty: true }), { type: 'array' });
  expect(raw.Sheets.Data.A1.c).toHaveLength(1); expect(raw.Sheets.Data.A1.c[0]).toMatchObject({ t: '', T: true });
});
it('imports threaded text as a threaded comment and preserves it when saved again', async () => {
  let wb = await workbookFromFile(native('A &amp; B _x005F_x0041_'), 'native.xlsx');
  expect(wb.activeSheet.comments.get('0,0').items[0].text).toBe('A & B _x0041_');
  expect(wb.activeSheet.notes.has('0,0')).toBe(false);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(wb.activeSheet.comments.get('0,0').items[0].text).toBe('A & B _x0041_');
});
