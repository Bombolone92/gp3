import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as P from '../src/lib/puter.js';
import { slugify, subdomainFor, siteUrl, publishDir, parseSiteRecord, PUBLISH_FOLDER } from '../src/lib/publish.js';

describe('publishing', () => {
  beforeEach(() => vi.spyOn(P, 'statFile').mockResolvedValue(null));
  afterEach(() => vi.restoreAllMocks());

  it('keeps colliding names and paths isolated when publishing or deleting pages', async () => {
    const P = await import('../src/lib/puter.js');
    const files = new Map();
    const hosting = new Map();
    vi.spyOn(P, 'writeFile').mockImplementation(async (path, blob) => { files.set(path, await blob.text()); });
    vi.spyOn(P, 'readFile').mockImplementation(async (path) => {
      if (!files.has(path)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return new Blob([files.get(path)]);
    });
    vi.spyOn(P, 'deleteFolder').mockImplementation(async (path) => {
      for (const k of files.keys()) if (k.startsWith(`${path}/`)) files.delete(k);
    });
    vi.spyOn(P, 'deleteFile').mockImplementation(async (path) => { files.delete(path); });
    vi.spyOn(P, 'hostingCreate').mockImplementation(async (sub, dir) => { hosting.set(sub, dir); return { subdomain: sub }; });
    vi.spyOn(P, 'hostingDelete').mockImplementation(async (sub) => { hosting.delete(sub); });
    const { publishPage, findSite, unpublishPage } = await import('../src/lib/publish.js');
    const paths = ['Documents/Notes.docx', 'Private/Notes.docx', 'Documents/Notes!.docx', 'Documents/한글.docx', 'Documents/문서.docx'];
    const sites = [];
    for (const [i, path] of paths.entries()) {
      expect(await findSite(path)).toBeNull();
      sites.push(await publishPage(path, path, `<p>Document ${i}</p>`, { random: () => (i + 1) / 10 }));
    }
    expect(new Set(sites.map((site) => site.dir)).size).toBe(paths.length);
    for (const [i, path] of paths.entries()) {
      expect(await findSite(path)).toMatchObject({ subdomain: sites[i].subdomain });
      expect(files.get(`${hosting.get(sites[i].subdomain)}/index.html`)).toBe(`<p>Document ${i}</p>`);
    }
    await unpublishPage(await findSite(paths[0]));
    for (const [i, site] of sites.entries()) {
      if (i) expect(files.get(`${site.dir}/index.html`)).toBe(`<p>Document ${i}</p>`);
    }
  });

  it('slugs names for folders and subdomains', async () => {
    expect(slugify('Q3 Report!')).toBe('q3-report');
    expect(slugify('  Résumé — Ana ')).toBe('resume-ana');
    expect(slugify('***')).toBe('document');
    expect(slugify('x'.repeat(60))).toHaveLength(40);
    const sub = subdomainFor('Meeting notes', () => 0.5);
    // The tail is the only thing keeping a published page from being guessed.
    expect(sub).toMatch(/^meeting-notes-[a-z0-9]{12}$/);
    const draws = [];
    subdomainFor('x', () => { draws.push(1); return Math.random(); });
    expect(draws).toHaveLength(12);
    expect(siteUrl(sub)).toBe(`https://${sub}.puter.site`);
    expect(await publishDir('Documents/Q3 Report.docx')).toMatch(/^Documents\/\.published\/q3-report-[a-f0-9]{64}$/);
  });

  it('reads site records and rejects broken ones', () => {
    expect(parseSiteRecord('{"subdomain":"abc-12345","docPath":"Documents/A.docx","publishedAt":5}')).toEqual({ subdomain: 'abc-12345', docPath: 'Documents/A.docx', publishedAt: 5 });
    expect(parseSiteRecord('{"subdomain":"Bad Name"}')).toBeNull();
    expect(parseSiteRecord('nope')).toBeNull();
    expect(parseSiteRecord('')).toBeNull();
  });

  it('keeps legacy publications working only for the document recorded as their owner', async () => {
    const P = await import('../src/lib/puter.js');
    const docPath = 'Documents/Notes.docx';
    const dir = `${PUBLISH_FOLDER}/notes`;
    const record = { docPath, subdomain: 'notes-existing', publishedAt: 5 };
    vi.spyOn(P, 'readFile').mockImplementation(async (path) => {
      if (path === `${dir}/site.json`) return new Blob([JSON.stringify(record)]);
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    });
    const write = vi.spyOn(P, 'writeFile').mockResolvedValue({});
    vi.spyOn(P, 'deleteFile').mockResolvedValue();
    const update = vi.spyOn(P, 'hostingUpdate').mockResolvedValue({});
    const create = vi.spyOn(P, 'hostingCreate').mockResolvedValue({ subdomain: 'new-page' });
    const { findSite, publishPage } = await import('../src/lib/publish.js');
    const legacy = await findSite(docPath);
    expect(legacy).toMatchObject({ ...record, dir });
    expect(await findSite('Other/Notes.docx')).toBeNull();
    expect(await publishPage(docPath, 'Notes', '<p>Updated</p>')).toMatchObject({ subdomain: record.subdomain, dir, created: false });
    expect(update).toHaveBeenCalledWith(record.subdomain, dir);
    expect(create).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(`${dir}/index.html`, expect.any(Blob));

    // Even a stale UI record must not attach a different document to this page.
    const separate = await publishPage('Other/Notes.docx', 'Notes', '<p>Other</p>', { existing: legacy });
    expect(separate.dir).not.toBe(dir);
    expect(separate.subdomain).toBe('new-page');
  });

  it('publishes, updates, and unpublishes through the Puter wrappers', async () => {
    const P = await import('../src/lib/puter.js');
    const files = new Map();
    const hosting = new Map();
    vi.spyOn(P, 'writeFile').mockImplementation(async (path, blob) => { files.set(path, await blob.text()); });
    vi.spyOn(P, 'readFile').mockImplementation(async (path) => { if (!files.has(path)) throw Object.assign(new Error('does not exist'), { code: 'subject_does_not_exist' }); return new Blob([files.get(path)]); });
    vi.spyOn(P, 'deleteFolder').mockImplementation(async (path) => { for (const k of [...files.keys()]) if (k.startsWith(`${path}/`)) files.delete(k); });
    vi.spyOn(P, 'deleteFile').mockImplementation(async (path) => { files.delete(path); });
    vi.spyOn(P, 'hostingCreate').mockImplementation(async (sub, dir) => { if (hosting.has(sub)) throw new Error('Subdomain already exists'); hosting.set(sub, dir); return { subdomain: sub }; });
    vi.spyOn(P, 'hostingUpdate').mockImplementation(async (sub, dir) => { if (!hosting.has(sub)) throw new Error('Subdomain does not exist'); hosting.set(sub, dir); });
    vi.spyOn(P, 'hostingDelete').mockImplementation(async (sub) => { hosting.delete(sub); });
    const { publishPage, findSite, unpublishPage } = await import('../src/lib/publish.js');

    expect(await findSite('Documents/Notes.docx')).toBeNull();
    const first = await publishPage('Documents/Notes.docx', 'Notes', '<p>Hi</p>', { random: () => 0.25 });
    expect(first.created).toBe(true);
    expect(first.dir).toBe(await publishDir('Documents/Notes.docx'));
    expect(hosting.get(first.subdomain)).toBe(first.dir);
    expect(files.get(`${first.dir}/index.html`)).toBe('<p>Hi</p>');
    const found = await findSite('Documents/Notes.docx');
    expect(found).toMatchObject({ subdomain: first.subdomain, url: first.url, dir: first.dir });

    const second = await publishPage('Documents/Notes.docx', 'Notes', '<p>Hi again</p>', { existing: found, random: () => 0.75 });
    expect(second.created).toBe(false);
    expect(second.subdomain).toBe(first.subdomain);
    expect(files.get(`${first.dir}/index.html`)).toBe('<p>Hi again</p>');

    // A subdomain that vanished on the server is recreated.
    hosting.delete(first.subdomain);
    const third = await publishPage('Documents/Notes.docx', 'Notes', '<p>Back</p>', { existing: found, random: () => 0.1 });
    expect(third.created).toBe(true);
    expect(third.subdomain).not.toBe(first.subdomain);

    await unpublishPage(await findSite('Documents/Notes.docx'));
    expect(hosting.size).toBe(0);
    expect(await findSite('Documents/Notes.docx')).toBeNull();
    await expect(publishPage(null, 'x', '')).rejects.toThrow('Save the document first');

    // Without an injected source the tail comes from the platform's random
    // values, not Math.random: it is what keeps the page from being guessed.
    const secure = vi.spyOn(crypto, 'getRandomValues');
    const guessable = vi.spyOn(Math, 'random');
    const fourth = await publishPage('Documents/Notes.docx', 'Notes', '<p>Secure</p>');
    expect(fourth.subdomain).toMatch(/^notes-[a-z0-9]{12}$/);
    expect(secure).toHaveBeenCalled();
    expect(guessable).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

it('takes a served folder only when it is one folder of its own under the publications folder', () => {
  const record = (dir) => parseSiteRecord(JSON.stringify({ subdomain: 'report-abc', docPath: 'Documents/Report.docx', dir }));
  expect(record('Documents/.published/report-abc').dir).toBe('Documents/.published/report-abc');
  // A damaged record naming the publications folder itself would have every page taken down with this one.
  expect(record('Documents/.published/').dir).toBeUndefined();
  expect(record('Documents/.published').dir).toBeUndefined();
  expect(record('Documents/.published/a/b').dir).toBeUndefined();
  expect(record('Documents/.published/..').dir).toBeUndefined();
  expect(record('Documents/Report').dir).toBeUndefined();
});
