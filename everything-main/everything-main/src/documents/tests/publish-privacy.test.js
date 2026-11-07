import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as P from '../src/lib/puter.js';
import { findSite, publishDir, publishPage, unpublishPage, movePublication, unpublishAt, PUBLISH_FOLDER } from '../src/lib/publish.js';

let files, hosting;
const missing = () => Object.assign(new Error('Not found'), { code: 'ENOENT' });
beforeEach(() => {
  files = new Map(); hosting = new Map();
  vi.spyOn(P, 'statFile').mockResolvedValue({ path: '/demo/AppData/documents-app/Documents' });
  vi.spyOn(P, 'writeFile').mockImplementation(async (path, blob) => { files.set(path, await blob.text()); });
  vi.spyOn(P, 'readFile').mockImplementation(async (path) => {
    if (!files.has(path)) throw missing();
    return new Blob([files.get(path)]);
  });
  vi.spyOn(P, 'deleteFile').mockImplementation(async (path) => { if (!files.delete(path)) throw missing(); });
  vi.spyOn(P, 'deleteFolder').mockImplementation(async (path) => {
    for (const key of files.keys()) if (key.startsWith(`${path}/`)) files.delete(key);
  });
  vi.spyOn(P, 'hostingCreate').mockImplementation(async (sub, dir) => { hosting.set(sub, dir); return { subdomain: sub }; });
  vi.spyOn(P, 'hostingUpdate').mockImplementation(async (sub, dir) => { hosting.set(sub, dir); });
  vi.spyOn(P, 'hostingDelete').mockImplementation(async (sub) => { hosting.delete(sub); });
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('finds and updates a published page through its other path form (absolute first: %s)', async (absoluteFirst) => {
  const relative = 'Documents/Notes.docx', absolute = '/demo/AppData/documents-app/Documents/Notes.docx';
  const [source, reopened] = absoluteFirst ? [absolute, relative] : [relative, absolute];
  const original = await publishPage(source, 'Notes', '<p>Original</p>');
  const found = await findSite(reopened);
  expect(found).toMatchObject({ dir: original.dir, subdomain: original.subdomain });
  const updated = await publishPage(reopened, 'Notes', '<p>Updated</p>', { existing: found });
  expect(updated).toMatchObject({ dir: original.dir, subdomain: original.subdomain, created: false });
  expect(hosting.size).toBe(1);
  expect(files.get(`${original.dir}/index.html`)).toBe('<p>Updated</p>');
  expect(await findSite(source)).toMatchObject({ dir: original.dir });
  await unpublishPage(await findSite(reopened));
  expect(hosting.size).toBe(0);
  expect(await findSite(source)).toBeNull();
});

it('does not match the app publication to the same filename in another absolute folder', async () => {
  await publishPage('Documents/Notes.docx', 'Notes', '<p>App document</p>');
  expect(await findSite('/demo/Documents/Notes.docx')).toBeNull();
  expect(await findSite('/demo/AppData/other-app/Documents/Notes.docx')).toBeNull();
});

it('reports a failed folder lookup instead of presenting an existing publication as absent', async () => {
  await publishPage('Documents/Notes.docx', 'Notes', '<p>App document</p>');
  P.statFile.mockRejectedValue(new Error('Connection lost'));
  await expect(publishPage('/demo/AppData/documents-app/Documents/Notes.docx', 'Notes', '<p>Updated</p>')).rejects.toThrow('Connection lost');
  expect(hosting.size).toBe(1);
});

it('keeps document paths and publication metadata outside the publicly served directory', async () => {
  const docPath = '/private-user/private-folder/Notes.docx';
  const site = await publishPage(docPath, 'Notes', '<p>Public text</p>');
  const publicFiles = () => [...files].filter(([path]) => path.startsWith(`${hosting.get(site.subdomain)}/`));
  expect(publicFiles()).toEqual([[`${site.dir}/index.html`, '<p>Public text</p>']]);
  expect(await findSite(docPath)).toMatchObject({ subdomain: site.subdomain, docPath });
  await publishPage(docPath, 'Notes', '<p>Updated</p>');
  expect(publicFiles()).toEqual([[`${site.dir}/index.html`, '<p>Updated</p>']]);
  await unpublishPage(await findSite(docPath));
  expect(await findSite(docPath)).toBeNull();
  expect(files.size).toBe(0);
});

it.each(['slug', 'digest'])('migrates a %s publication record while keeping its URL and directory', async (format) => {
  const docPath = 'Documents/Notes.docx';
  const dir = format === 'slug' ? `${PUBLISH_FOLDER}/notes` : await publishDir(docPath);
  const record = { docPath, subdomain: 'notes-existing', publishedAt: 5 };
  files.set(`${dir}/site.json`, JSON.stringify(record));
  files.set(`${dir}/index.html`, '<p>Old page</p>');
  hosting.set(record.subdomain, dir);
  expect(await findSite(docPath)).toMatchObject({ ...record, dir });
  const updated = await publishPage(docPath, 'Notes', '<p>Updated</p>');
  expect(updated).toMatchObject({ subdomain: record.subdomain, dir, created: false });
  expect(files.has(`${dir}/site.json`)).toBe(false);
  expect(await findSite(docPath)).toMatchObject({ docPath, dir, subdomain: record.subdomain });
  expect(hosting.get(record.subdomain)).toBe(dir);
  await unpublishPage(await findSite(docPath));
  expect(files.size).toBe(0);
});

it('retains the private record and reports failure if removing legacy public metadata fails', async () => {
  const docPath = 'Documents/Notes.docx', dir = await publishDir(docPath);
  files.set(`${dir}/site.json`, JSON.stringify({ docPath, subdomain: 'notes-existing' }));
  P.deleteFile.mockRejectedValueOnce(new Error('Permission denied'));
  await expect(publishPage(docPath, 'Notes', '<p>Updated</p>')).rejects.toThrow('Permission denied');
  expect(await findSite(docPath)).toMatchObject({ subdomain: 'notes-existing' });
  await publishPage(docPath, 'Notes', '<p>Updated</p>');
  expect(files.has(`${dir}/site.json`)).toBe(false);
});

it('takes a new page offline if its publication record cannot be saved, then allows retry', async () => {
  P.writeFile.mockImplementation(async (path, blob) => {
    if (path.endsWith('.json')) throw new Error('Storage unavailable');
    files.set(path, await blob.text());
  });
  await expect(publishPage('Documents/Notes.docx', 'Notes', '<p>Content</p>')).rejects.toThrow('Storage unavailable');
  expect(hosting.size).toBe(0);
  expect(await findSite('Documents/Notes.docx')).toBeNull();
  P.writeFile.mockImplementation(async (path, blob) => { files.set(path, await blob.text()); });
  const site = await publishPage('Documents/Notes.docx', 'Notes', '<p>Content</p>');
  expect(hosting.size).toBe(1);
  expect(await findSite('Documents/Notes.docx')).toMatchObject({ subdomain: site.subdomain });
});

it('keeps an existing page online if saving its updated record fails', async () => {
  const site = await publishPage('Documents/Notes.docx', 'Notes', '<p>Content</p>');
  P.writeFile.mockImplementation(async (path, blob) => {
    if (path.endsWith('.json')) throw new Error('Storage unavailable');
    files.set(path, await blob.text());
  });
  await expect(publishPage('Documents/Notes.docx', 'Notes', '<p>Updated</p>')).rejects.toThrow('Storage unavailable');
  expect(hosting.get(site.subdomain)).toBe(site.dir);
  expect(P.hostingDelete).not.toHaveBeenCalled();
});

it('reports the live URL when a failed publication also cannot be taken offline', async () => {
  P.writeFile.mockImplementation(async (path, blob) => {
    if (path.endsWith('.json')) throw new Error('Storage unavailable');
    files.set(path, await blob.text());
  });
  P.hostingDelete.mockRejectedValue(new Error('Offline'));
  await expect(publishPage('Documents/Notes.docx', 'Notes', '<p>Content</p>', { random: () => 0 }))
    .rejects.toThrow('https://notes-aaaaaaaaaaaa.puter.site');
  expect(hosting.size).toBe(1);
});

it('looks the publication records up side by side rather than one round trip after another', async () => {
  // Each read settles only once the whole batch of record lookups has been requested.
  const pending = [];
  P.readFile.mockImplementation((path) => new Promise((resolve, reject) => {
    pending.push({ path, resolve, reject });
    if (pending.length % 4 === 0) for (const item of pending.splice(0)) item.reject(missing());
  }));
  await expect(findSite('Documents/Notes.docx')).resolves.toBeNull();
  expect(pending).toEqual([]);
});

it('prefers the path-based record over a legacy record even when the legacy read answers first', async () => {
  const docPath = 'Documents/Notes.docx';
  const dir = await publishDir(docPath);
  files.set(`${dir}.json`, JSON.stringify({ subdomain: 'newer-12345', docPath, publishedAt: 2 }));
  files.set(`${PUBLISH_FOLDER}/notes.json`, JSON.stringify({ subdomain: 'older-12345', docPath, publishedAt: 1 }));
  P.readFile.mockImplementation((path) => new Promise((resolve, reject) => setTimeout(() => {
    if (!files.has(path)) reject(missing()); else resolve(new Blob([files.get(path)]));
  }, path.endsWith('/notes.json') ? 0 : 5)));
  expect(await findSite(docPath)).toMatchObject({ subdomain: 'newer-12345', dir });
});

it('keeps a published page under its address when the document is renamed, and takes it down with the document', async () => {
  const original = await publishPage('Documents/Draft.docx', 'Draft', '<p>v1</p>');
  const moved = await movePublication('Documents/Draft.docx', 'Documents/Final.docx');
  expect(moved).toMatchObject({ subdomain: original.subdomain, dir: original.dir, docPath: 'Documents/Final.docx' });
  // The old record is gone; the new path finds the same page and folder.
  expect(await findSite('Documents/Draft.docx')).toBeNull();
  const found = await findSite('Documents/Final.docx');
  expect(found).toMatchObject({ subdomain: original.subdomain, dir: original.dir, url: original.url });
  expect(found.recordPath).toBe(`${await publishDir('Documents/Final.docx')}.json`);
  // Updating writes the same folder and keeps the record where the new path looks for it.
  const updated = await publishPage('Documents/Final.docx', 'Final', '<p>v2</p>', { existing: found });
  expect(updated).toMatchObject({ subdomain: original.subdomain, dir: original.dir, created: false });
  expect(files.get(`${original.dir}/index.html`)).toBe('<p>v2</p>');
  expect(files.get(found.recordPath)).toContain(`"dir":"${original.dir}"`);
  expect([...files.keys()].filter((k) => k.endsWith('.json'))).toEqual([found.recordPath]);
  // Renaming an unpublished document does nothing.
  expect(await movePublication('Documents/Other.docx', 'Documents/Else.docx')).toBeNull();
  // Deleting the document takes everything down.
  expect(await unpublishAt('Documents/Final.docx')).toBe(true);
  expect(hosting.size).toBe(0);
  expect([...files.keys()].some((k) => k.startsWith(PUBLISH_FOLDER))).toBe(false);
  expect(await unpublishAt('Documents/Final.docx')).toBe(false);
});
