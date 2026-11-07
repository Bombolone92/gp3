import { describe, it, expect } from 'vitest';
import { recentFiles, RECENT_LIMIT } from '../src/lib/recent.js';

describe('recentFiles', () => {
  const files = [
    { name: 'b.docx', path: 'Documents/b.docx', modified: 100 },
    { name: 'a.docx', path: 'Documents/a.docx', modified: 300 },
    { name: 'c.docx', path: 'Documents/c.docx', modified: 300 },
    { name: 'open.docx', path: 'Documents/open.docx', modified: 900 },
  ];

  it('orders newest first, breaks ties by name, and leaves out the open document', () => {
    expect(recentFiles(files, { exclude: 'Documents/open.docx' }).map((f) => f.name)).toEqual(['a.docx', 'c.docx', 'b.docx']);
    expect(recentFiles(files).map((f) => f.name)[0]).toBe('open.docx');
  });

  it('caps the list and copes with empty input', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `${i}.docx`, path: `Documents/${i}.docx`, modified: i }));
    expect(recentFiles(many)).toHaveLength(RECENT_LIMIT);
    expect(recentFiles(many, { limit: 3 }).map((f) => f.modified)).toEqual([19, 18, 17]);
    expect(recentFiles(null)).toEqual([]);
    expect(recentFiles([null, { name: 'x' }])).toEqual([]);
  });
});
