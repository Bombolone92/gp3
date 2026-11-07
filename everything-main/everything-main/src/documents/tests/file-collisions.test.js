import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Doc, versioning } from '../src/lib/doc.js';
import { saveAsTemplate } from '../src/lib/customtemplates.js';

describe('concurrent file creation', () => {
  let files, docs;
  beforeEach(() => {
    files = new Map(); docs = [];
    versioning.enabled = false;
    vi.stubGlobal('puter', { fs: {
      mkdir: async () => {},
      stat: async (path) => {
        if (!files.has(path)) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
        return { path };
      },
      // Model the documented server-side collision behavior, including the
      // actual path returned when the server assigns a different name.
      write: vi.fn(async (path, blob, { overwrite, dedupeName }) => {
        let target = path, n = 1;
        while (files.has(target) && dedupeName) target = path.replace(/(\.[^/.]+)$/, ` (${n++})$1`);
        if (files.has(target) && !overwrite) throw new Error('A file with that name already exists');
        files.set(target, blob);
        return { path: target, name: target.split('/').pop() };
      }),
    } });
  });
  afterEach(() => { docs.forEach((doc) => doc.destroy()); vi.unstubAllGlobals(); versioning.enabled = true; });
  function document(name, text) {
    const doc = Doc.blank({ name });
    doc.attach(async () => new Blob([text])); doc.changed(); docs.push(doc);
    return doc;
  }

  it('preserves both new documents with the same name and autosaves to their own paths', async () => {
    const a = document('Report', 'first'), b = document('Report', 'second');
    await Promise.all([a.save(), b.save()]);
    expect(files.size).toBe(2);
    expect(a.path).not.toBe(b.path);
    expect(b.name).toBe('Report (1)');
    b.attach(async () => new Blob(['second updated'])); b.changed(); await b.save();
    expect(await files.get(a.path).text()).toBe('first');
    expect(await files.get(b.path).text()).toBe('second updated');
  });

  it('refuses a Save a copy collision that appears while exporting', async () => {
    const doc = document('Original', 'original');
    await doc.save();
    doc.attach(async () => { files.set('Documents/Copy.docx', new Blob(['other tab'])); return new Blob(['mine']); });
    expect(await doc.saveAs('Copy')).toMatch(/already exists/);
    expect(doc.path).toBe('Documents/Original.docx');
    expect(await files.get('Documents/Copy.docx').text()).toBe('other tab');
  });

  it('only replaces a template when replacement was explicitly selected', async () => {
    await saveAsTemplate(new Blob(['original']), 'Letter');
    await expect(saveAsTemplate(new Blob(['unconfirmed']), 'Letter')).rejects.toThrow(/already exists/);
    expect(await files.get('Documents/Templates/Letter.docx').text()).toBe('original');
    await saveAsTemplate(new Blob(['replacement']), 'Letter', { overwrite: true });
    expect(await files.get('Documents/Templates/Letter.docx').text()).toBe('replacement');
  });
});
