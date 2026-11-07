import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/** ENCODEURL of a cell holding `text` as stored, since typing cannot produce half a surrogate pair. */
function encoded(text) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: text, f: null } }]);
  wb.setInput(id, 1, 0, '=ENCODEURL(A1)');
  return wb.getValue(id, 1, 0);
}

// encodeURIComponent throws on a lone surrogate, which a pasted or imported cell can hold, and the
// formula showed #ERROR!.
describe('ENCODEURL', () => {
  it('writes a lone surrogate as the replacement character, as a URL parser does', () => {
    expect(encoded('\ud83d')).toBe('%EF%BF%BD');
    expect(encoded('\ude00')).toBe('%EF%BF%BD');
    expect(encoded('a\ud83db')).toBe('a%EF%BF%BDb');
  });

  it('still encodes whole characters and pairs', () => {
    expect(encoded('a b')).toBe('a%20b');
    expect(encoded('\u{1F600}')).toBe('%F0%9F%98%80');
    expect(encoded("it's (ok)*!")).toBe('it%27s%20%28ok%29%2A%21');
  });
});
