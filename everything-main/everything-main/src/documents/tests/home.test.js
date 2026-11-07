// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { sortFiles, rememberedSort, SORTS } from '../src/views/home.js';

const files = [
  { name: 'Notes 10.docx', size: 300, modified: 100 },
  { name: 'Agenda.docx', size: 900, modified: 300 },
  { name: 'notes 2.docx', size: 300, modified: 200 },
];

describe('sortFiles', () => {
  it('orders by modified (newest first), name (natural, case-insensitive), or size (largest first)', () => {
    expect(sortFiles(files, 'modified').map((f) => f.name)).toEqual(['Agenda.docx', 'notes 2.docx', 'Notes 10.docx']);
    expect(sortFiles(files, 'name').map((f) => f.name)).toEqual(['Agenda.docx', 'notes 2.docx', 'Notes 10.docx']);
    expect(sortFiles(files, 'size').map((f) => f.name)).toEqual(['Agenda.docx', 'Notes 10.docx', 'notes 2.docx']);
    expect(sortFiles(files, 'bogus').map((f) => f.name)).toEqual(['Agenda.docx', 'notes 2.docx', 'Notes 10.docx']);
    expect(files.map((f) => f.name)).toEqual(['Notes 10.docx', 'Agenda.docx', 'notes 2.docx']);
  });

  it('orders names as shown, without the extension competing with spaces and dashes', () => {
    const names = ['Notes-2.docx', 'Notes (draft).docx', 'Notes.docx', 'Notes 3.docx'].map((name) => ({ name, path: `Documents/${name}`, size: 1, modified: 1 }));
    expect(sortFiles(names, 'name').map((f) => f.name)).toEqual(['Notes.docx', 'Notes (draft).docx', 'Notes 3.docx', 'Notes-2.docx']);
  });

  it('remembers only known sort keys', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
    expect(rememberedSort()).toBe('modified');
    localStorage.setItem('documents:sort', 'name');
    expect(rememberedSort()).toBe('name');
    localStorage.setItem('documents:sort', 'nonsense');
    expect(rememberedSort()).toBe('modified');
    expect(SORTS.map((s) => s.id)).toEqual(['modified', 'name', 'size']);
  });
});

describe('importableFiles', () => {
  it('keeps DOCX-family documents and text formats, in order', async () => {
    const { importableFiles } = await import('../src/lib/importfiles.js');
    const files = [{ name: 'a.docx' }, { name: 'photo.png' }, { name: 'B.DOTX' }, { name: 'notes.txt' }, { name: 'c.docm' }, { name: 'readme.md' }, { name: 'page.html' }, { name: '한글.HWP' }, { name: '양식.hwpx' }];
    expect(importableFiles(files).map((f) => f.name)).toEqual(['a.docx', 'B.DOTX', 'notes.txt', 'c.docm', 'readme.md', 'page.html', '한글.HWP', '양식.hwpx']);
    expect(importableFiles(null)).toEqual([]);
  });
});
