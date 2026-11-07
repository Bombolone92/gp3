/**
 * Publishing a document as a web page on Puter hosting. The HTML export is
 * written to Documents/.published/<slug>/index.html, and that folder is
 * served from a puter.site subdomain (puter.hosting). A private JSON file
 * beside the served folder records the subdomain and source path, so any
 * device can find the publication without exposing that metadata to readers.
 * Updating rewrites index.html; stopping deletes the site, folder, and record.
 */

import * as P from './puter.js';

export const PUBLISH_FOLDER = `${P.FOLDER}/.published`;
export const SITE_HOST = 'puter.site';

/** A folder and subdomain-safe slug from a document name ("Q3 Report!" -> "q3-report"). */
export function slugify(name) {
  const s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'document';
}

/** A number in [0, 1) from the platform's random source; the tail is the only thing keeping the page from being guessed. */
function secureRandom() {
  if (typeof crypto?.getRandomValues === 'function') return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  return Math.random();
}

const TAIL_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/**
 * Characters of random tail. A page is private only in that its address is
 * not published anywhere, and the slug in front of the tail comes from the
 * document's name, which is often an ordinary word ("notes", "resume"). The
 * tail is therefore the whole secret, and is drawn one character at a time so
 * it carries about sixty bits rather than the twenty-five a single float has.
 */
const TAIL_LENGTH = 12;

/** A subdomain that is unlikely to collide or be guessed: the slug plus a random tail. */
export function subdomainFor(name, random = secureRandom) {
  let tail = '';
  for (let i = 0; i < TAIL_LENGTH; i++) tail += TAIL_ALPHABET[Math.floor(random() * TAIL_ALPHABET.length) % TAIL_ALPHABET.length];
  return `${slugify(name).slice(0, 30).replace(/-+$/g, '')}-${tail}`;
}

export function siteUrl(subdomain) {
  return `https://${subdomain}.${SITE_HOST}`;
}

function legacyPublishDir(docPath) {
  return `${PUBLISH_FOLDER}/${slugify(P.stripExtension(P.displayName(docPath)))}`;
}

/** Include the full path's digest so similar names and separate folders never share a page. */
export async function publishDir(docPath) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(docPath));
  const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${legacyPublishDir(docPath)}-${key}`;
}

/**
 * The record a published document keeps next to its page. `dir` names the
 * served folder when it is not the one the record sits beside: a renamed
 * document's record moves to the new path's place while the page stays put.
 */
export function parseSiteRecord(text) {
  try {
    const r = JSON.parse(String(text || ''));
    if (!r || typeof r.subdomain !== 'string' || !/^[a-z0-9-]+$/.test(r.subdomain)) return null;
    const record = { subdomain: r.subdomain, docPath: String(r.docPath || ''), publishedAt: Number(r.publishedAt) || 0 };
    // One folder of its own under the publications folder: the folder itself, or a path with more in it, is not a page's.
    const own = typeof r.dir === 'string' && r.dir.startsWith(`${PUBLISH_FOLDER}/`) ? r.dir.slice(PUBLISH_FOLDER.length + 1) : '';
    if (own && !own.includes('/') && !/^\.\.?$/.test(own)) record.dir = r.dir;
    return record;
  } catch {
    return null;
  }
}

/**
 * The published site for a document, or null when it is not published. The
 * lookups run side by side: each is a cloud round trip, and the details and
 * publish dialogs wait on the answer.
 */
export async function findSite(docPath) {
  if (!docPath) return null;
  const [site, alternate] = await Promise.all([findSiteAtPath(docPath), alternatePath(docPath).then((path) => ({ path }), (error) => ({ error }))]);
  if (site) return site;
  // A failed root lookup must not present an existing publication as absent.
  if (alternate.error) throw alternate.error;
  return alternate.path ? findSiteAtPath(alternate.path) : null;
}

/**
 * The other spelling of a document path: creation uses app-relative paths,
 * while file listings and pickers return absolute ones. Only after verifying
 * the app root; null when there is no other spelling.
 */
async function alternatePath(docPath) {
  if (!docPath.startsWith(`${P.FOLDER}/`) && !docPath.startsWith('/')) return null;
  const root = (await P.statFile(P.FOLDER))?.path;
  if (!root?.startsWith('/')) return null;
  return docPath.startsWith(`${P.FOLDER}/`) ? `${root}/${docPath.slice(P.FOLDER.length + 1)}`
    : docPath.startsWith(`${root}/`) ? `${P.FOLDER}/${docPath.slice(root.length + 1)}` : null;
}

/** The record for a document at either of its folders, read concurrently and taken in order of preference. */
async function findSiteAtPath(docPath) {
  const candidates = [];
  for (const dir of [await publishDir(docPath), legacyPublishDir(docPath)]) {
    for (const path of [`${dir}.json`, `${dir}/site.json`]) candidates.push({ dir, path });
  }
  const results = await Promise.allSettled(candidates.map(({ path }) => P.readFile(path).then((blob) => blob.text())));
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') { if (P.isNotFound(result.reason)) continue; throw result.reason; }
    const record = parseSiteRecord(result.value);
    // Old slug-only folders may belong to a different document. Never claim them.
    if (record?.docPath === docPath) return { ...record, dir: record.dir || candidates[i].dir, recordPath: candidates[i].path, url: siteUrl(record.subdomain) };
  }
  return null;
}

/**
 * A renamed or moved document keeps its page: the record moves to the new
 * path's place and points at the folder that is already served. Resolves
 * the site, or null when the document was not published.
 */
export async function movePublication(fromPath, toPath) {
  if (!fromPath || !toPath || fromPath === toPath) return null;
  const site = await findSite(fromPath);
  if (!site) return null;
  const recordPath = `${await publishDir(toPath)}.json`;
  const record = { subdomain: site.subdomain, docPath: toPath, publishedAt: site.publishedAt, dir: site.dir };
  await P.writeFile(recordPath, new Blob([JSON.stringify(record)], { type: 'application/json' }));
  if (site.recordPath && site.recordPath !== recordPath) {
    try { await P.deleteFile(site.recordPath); } catch (e) { if (!P.isNotFound(e)) throw e; }
  }
  return { ...record, recordPath, url: siteUrl(site.subdomain) };
}

/** Take down the page of a document that is being deleted, if it has one. Resolves whether one was. */
export async function unpublishAt(docPath) {
  const site = await findSite(docPath);
  if (!site) return false;
  await unpublishPage(site);
  return true;
}

/**
 * Publish or update: write the page, then create the subdomain the first
 * time. Resolves { subdomain, url, dir, publishedAt, created }.
 */
export async function publishPage(docPath, name, html, { existing = null, random = secureRandom } = {}) {
  if (!docPath) throw new Error('Save the document first');
  const ownDir = await publishDir(docPath);
  const site = existing?.docPath === docPath && [ownDir, legacyPublishDir(docPath)].includes(existing.dir)
    ? existing : await findSite(docPath);
  // Keep existing links working, including publications made before path-based folders.
  const dir = site?.dir || ownDir;
  await P.writeFile(`${dir}/index.html`, new Blob([html], { type: 'text/html;charset=utf-8' }));
  let subdomain = site?.subdomain || null;
  let created = false;
  if (subdomain) {
    // The folder is already served; make sure the subdomain still points at it.
    try { await P.hostingUpdate(subdomain, dir); } catch (e) { if (!/not.*(found|exist)/i.test(String(e?.message || e))) throw e; subdomain = null; }
  }
  if (!subdomain) {
    for (let attempt = 0; attempt < 3 && !subdomain; attempt++) {
      const candidate = subdomainFor(name, random);
      try {
        const site = await P.hostingCreate(candidate, dir);
        subdomain = site?.subdomain || candidate;
        created = true;
      } catch (e) {
        if (attempt === 2 || !/exist|taken|already/i.test(String(e?.message || e))) throw e;
      }
    }
  }
  const publishedAt = Date.now();
  // Keep the original record's identity, so both path forms can still find it
  // in its original directory after an update through the other form.
  const sourcePath = site?.docPath || docPath;
  // A moved record stays where the document's current path looks for it; an
  // old public record inside the folder migrates to the private one beside it.
  const recordPath = site?.recordPath && !site.recordPath.endsWith('/site.json') ? site.recordPath : `${dir}.json`;
  const record = { subdomain, docPath: sourcePath, publishedAt };
  if (recordPath !== `${dir}.json`) record.dir = dir;
  try {
    await P.writeFile(recordPath, new Blob([JSON.stringify(record)], { type: 'application/json' }));
  } catch (error) {
    // A new site must not remain public and undiscoverable after publication
    // reports failure. Existing sites retain their record and stay online.
    if (created) {
      try { await P.hostingDelete(subdomain); }
      catch (cleanupError) {
        if (!P.isNotFound(cleanupError)) {
          throw new Error(`The page may still be live at ${siteUrl(subdomain)}, but its publication record could not be saved. Check this address and remove the page from Puter hosting.`, { cause: error });
        }
      }
    }
    throw error;
  }
  // Persist the private record before removing an older public record, so
  // interrupted migrations remain discoverable and can be retried safely.
  if (site) {
    try { await P.deleteFile(`${dir}/site.json`); } catch (e) { if (!P.isNotFound(e)) throw e; }
  }
  return { subdomain, docPath: sourcePath, url: siteUrl(subdomain), dir, recordPath, publishedAt, created };
}

/** Take the page down: delete the subdomain, then the folder and the record. */
export async function unpublishPage(site) {
  if (!site?.subdomain) return;
  try { await P.hostingDelete(site.subdomain); } catch (e) { if (!/not.*(found|exist)/i.test(String(e?.message || e))) throw e; }
  try { await P.deleteFolder(site.dir); } catch (e) { if (!P.isNotFound(e)) throw e; }
  for (const path of new Set([`${site.dir}.json`, site.recordPath].filter(Boolean))) {
    try { await P.deleteFile(path); } catch (e) { if (!P.isNotFound(e)) throw e; }
  }
}
