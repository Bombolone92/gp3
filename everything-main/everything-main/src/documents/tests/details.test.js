import { describe, it, expect, vi } from 'vitest';
import { folderOf, toMillis, whenText, detailRows } from '../src/lib/details.js';

describe('document details', () => {
  const now = Date.UTC(2026, 7, 28, 18, 0, 0);

  it('reads the folder and normalizes timestamps', () => {
    expect(folderOf('Documents/Report.docx')).toBe('Documents');
    expect(folderOf('Documents/Sub/Report.docx')).toBe('Documents/Sub');
    expect(folderOf('Report.docx')).toBe('');
    expect(toMillis(1700000000)).toBe(1700000000000);
    expect(toMillis(1700000000000)).toBe(1700000000000);
    expect(toMillis('1700000000')).toBe(1700000000000);
    expect(toMillis(null)).toBeNull();
    expect(toMillis(0)).toBeNull();
  });

  it('shows a date with how long ago it was', () => {
    expect(whenText(now - 2 * 3600 * 1000, now)).toMatch(/\(2 hours ago\)$/);
    expect(whenText((now - 60 * 1000) / 1000, now)).toMatch(/\(1 min ago\)$/);
    expect(whenText(now - 30 * 86400 * 1000, now)).not.toMatch(/ago/);
    expect(whenText(null, now)).toBe('');
  });

  it('does not repeat an old date in parentheses whatever the locale writes it like', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('6 sept. 2026');
    try {
      expect(whenText(now - 30 * 86400 * 1000, now)).not.toMatch(/\(/);
      expect(whenText(now - 2 * 3600 * 1000, now)).toMatch(/\(2 hours ago\)$/);
    } finally { spy.mockRestore(); }
  });

  it('lists the rows for a saved document and for a new one', () => {
    const rows = detailRows({ name: 'Report', path: 'Documents/Report.docx', size: 2048, created: (now - 86400000) / 1000, modified: (now - 3600000) / 1000, lastSaved: now - 60000, pages: 3, words: 1204, publishedUrl: null }, { now });
    expect(rows.map((r) => r.label)).toEqual(['Name', 'Location', 'Size', 'Created', 'Modified', 'Last saved here', 'Length', 'Published']);
    expect(rows[0].value).toBe('Report.docx');
    expect(rows[1].value).toBe('Documents/ on your Puter drive');
    expect(rows[2].value).toBe('2.0 KB');
    expect(rows[3].value).toMatch(/\(1 day ago\)/);
    expect(rows[6].value).toBe('3 pages, 1,204 words');
    expect(rows[7].value).toBe('Not published');
    const fresh = detailRows({ name: 'Untitled document', path: null, pages: 1, words: 1 }, { now });
    expect(fresh.map((r) => r.label)).toEqual(['Name', 'Location', 'Length']);
    expect(fresh[0].value).toBe('Untitled document.docx');
    expect(fresh[1].value).toBe('Not saved yet');
    // A template or macro file opened as it stands keeps its own extension until it is saved.
    expect(detailRows({ name: 'Letterhead', path: 'Documents/Letterhead.dotx' }, { now })[0].value).toBe('Letterhead.dotx');
    expect(fresh[2].value).toBe('1 page, 1 word');
    const opened = detailRows({ name: 'X', path: 'Documents/X.docx', size: 10 }, { now });
    expect(opened.find((r) => r.label === 'Last saved here').value).toBe('Unchanged since it was opened');
    expect(detailRows({ name: 'X', path: 'Documents/X.docx', saved: false }, { now }).find((r) => r.label === 'Last saved here').value).toBe('Not yet, this session');
    expect(detailRows({ name: 'Y', path: 'Documents/Y.docx', publishedUrl: 'https://a.puter.site' }, { now }).at(-1).value).toBe('https://a.puter.site');
  });
});
