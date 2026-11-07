/**
 * Photos and documents live in the app's own Puter folder (or, for a school
 * with staff and family access, in the director's drive behind the school
 * worker), never in KV. Records keep only a small reference:
 *   { id, name, type, size, path, thumb?, w?, h? }
 *
 * Paths are "<area>/<owner>/<id>-<name>", e.g. media/2026-10/k3x9-park.jpg
 * or students/<studentId>/k3xa-photo.jpg. The worker uses the area and
 * owner to decide who may read a file.
 *
 * Photos are downscaled in the browser before upload (createImageBitmap and
 * OffscreenCanvas, off the main thread's layout work) and get a small
 * thumbnail, so feeds download a few dozen kilobytes per photo. Downloaded
 * files are immutable (every path is unique), so they are kept in an
 * IndexedDB cache and never fetched twice.
 *
 * In the demo there is no cloud, so files live in memory for the session.
 */
import { app } from './app.js';
import { newId } from './core/ids.js';
import { uploadFile, downloadFile, call } from './team.js';

const MAX_EDGE = 1920;
const THUMB_EDGE = 480;
const MAX_BYTES = 25 * 1024 * 1024;
export const TEAM_MAX_BYTES = 12 * 1024 * 1024; // what the school server accepts per file
const memory = new Map(); // demo: path -> Blob
const urlCache = new Map(); // path -> object URL, least recently used first
const MAX_URLS = 400; // each object URL keeps its file in memory
const inflight = new Map(); // path -> Promise<url>

export function isImage(type) {
  return /^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/i.test(type || '');
}

async function drawScaled(bmp, edge, type, quality) {
  const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type, quality }) : await new Promise((r) => canvas.toBlob(r, type, quality));
  return { blob, w, h };
}

/** Resize a photo and make its thumbnail. Non-photos pass through. */
export async function preparePhoto(file) {
  if (!/^image\/(png|jpe?g|webp|heic|heif|avif)$/i.test(file.type) || typeof createImageBitmap !== 'function') return { blob: file };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const big = Math.max(bmp.width, bmp.height) > MAX_EDGE || file.size > 1.5 * 1024 * 1024 || !/png|jpe?g|webp/i.test(file.type) ? await drawScaled(bmp, MAX_EDGE, type, 0.85) : { blob: file, w: bmp.width, h: bmp.height };
    const thumb = Math.max(bmp.width, bmp.height) > THUMB_EDGE ? await drawScaled(bmp, THUMB_EDGE, 'image/jpeg', 0.78) : null;
    bmp.close?.();
    // HEIC and HEIF only display in Safari, so they are converted even when
    // the JPEG comes out larger.
    const blob = big.blob && (big.blob.size < file.size || !isImage(file.type)) ? big.blob : file;
    return { blob, thumb: thumb?.blob || null, w: big.w, h: big.h };
  } catch {
    return { blob: file };
  }
}

function safeName(name) {
  return String(name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[.\s]+/, '').slice(-80) || 'file';
}

async function writeBlob(path, blob) {
  if (app.demo || typeof puter === 'undefined') memory.set(path, blob);
  else if (app.team?.url) await uploadFile(app.team.url, path, blob);
  else await puter.fs.write(path, blob, { createMissingParents: true, overwrite: true });
}

/**
 * Upload one File under area/owner. Resolves the attachment reference.
 * area: 'media' (activity photos; owner = month), 'students', 'messages', 'staff', 'school'.
 */
export async function saveFile(file, { area, owner }) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  const { blob, thumb, w, h } = await preparePhoto(file);
  if (app.team?.url && blob.size > TEAM_MAX_BYTES) throw new Error(`${file.name} is larger than 12 MB, the limit for a shared school.`);
  const id = newId();
  // A photo converted to JPEG gets a name that says so.
  const name = blob !== file && blob.type === 'image/jpeg' && !/\.jpe?g$/i.test(file.name) ? `${String(file.name || 'photo').replace(/\.[^.]*$/, '')}.jpg` : file.name;
  const base = safeName(name);
  const path = `${area}/${owner}/${id}-${base}`;
  const thumbPath = thumb ? `${area}/${owner}/${id}-t.jpg` : null;
  await writeBlob(path, blob);
  if (thumb) {
    try {
      await writeBlob(thumbPath, thumb);
    } catch (err) {
      // Nothing will refer to the photo, so do not leave it in storage.
      await deleteFile({ path }).catch(() => {});
      throw err;
    }
  }
  const type = blob.type || file.type || 'application/octet-stream';
  // What was just uploaded can be shown without downloading it again.
  remember(path, blob);
  if (thumb) remember(thumbPath, thumb);
  return clean({ id, name, type, size: blob.size, path, thumb: thumbPath, w, h });
}

function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

function remember(path, blob) {
  if (!urlCache.has(path)) cacheUrl(path, URL.createObjectURL(blob));
  blobCache.put(path, blob);
}

/** Keep an object URL, releasing the least recently used beyond the cap. */
function cacheUrl(path, url) {
  urlCache.delete(path);
  urlCache.set(path, url);
  for (const [p, u] of urlCache) {
    if (urlCache.size <= MAX_URLS) break;
    urlCache.delete(p);
    URL.revokeObjectURL(u); // images already showing it stay on screen
  }
}

/**
 * Object URL for an attachment (or its thumbnail with { thumb: true }).
 * `ref` and `id` name the record that shows the file; families need them so
 * the school server can check they may see it.
 */
export function fileUrl(att, { thumb = false, ref, id } = {}) {
  const path = thumb && att.thumb ? att.thumb : att.path;
  if (urlCache.has(path)) {
    const url = urlCache.get(path);
    cacheUrl(path, url);
    return Promise.resolve(url);
  }
  if (inflight.has(path)) return inflight.get(path);
  const p = (async () => {
    let blob = memory.get(path) || (await blobCache.get(path));
    if (!blob) {
      if (app.demo || typeof puter === 'undefined') throw new Error('File not available');
      blob = app.team?.url ? await downloadFile(app.team.url, path, { ref, id, type: att.type }) : await puter.fs.read(path);
      blobCache.put(path, blob);
    }
    const type = path === att.thumb ? 'image/jpeg' : att.type;
    if (type && blob.type !== type) blob = new Blob([blob], { type });
    const url = URL.createObjectURL(blob);
    cacheUrl(path, url);
    return url;
  })();
  inflight.set(path, p);
  p.finally(() => inflight.delete(path)).catch(() => {});
  return p;
}

export async function deleteFile(att) {
  for (const path of [att.path, att.thumb].filter(Boolean)) {
    memory.delete(path);
    const url = urlCache.get(path);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(path);
    blobCache.del(path);
    if (app.demo || typeof puter === 'undefined') continue;
    if (app.team?.url) {
      await call(app.team.url, 'fileDelete', { path }).catch(() => {});
    } else {
      try {
        await puter.fs.delete(path);
      } catch (err) {
        if (!/not.?found|subject_does_not_exist/i.test(String(err?.code || err?.message || err))) throw err;
      }
    }
  }
}

/** Forget the files cached on this device for a person (signing out). */
export async function clearFileCache(uuid) {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  await blobCache.clear(`${uuid}|`);
}

/** Demo files are generated in the browser and kept in memory. */
export function putDemoFile(path, blob) {
  memory.set(path, blob);
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/**
 * Persistent cache of downloaded files, keyed by path (paths never change
 * content). Keeps the most recent entries and drops the rest, checking on the
 * first write of every visit and every 50 writes after.
 */
const blobCache = (() => {
  const DB = 'childcare-files';
  const STORE = 'blobs';
  const MAX = 600;
  let dbp = null;
  const open = () =>
    (dbp ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = (e) => {
        const store = e.oldVersion < 1 ? req.result.createObjectStore(STORE) : req.transaction.objectStore(STORE);
        // Lets pruning find the oldest entries without reading any file.
        if (!store.indexNames.contains('at')) store.createIndex('at', 'at');
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('file cache blocked by another tab'));
    }));
  const scope = () => (app.user ? `${app.user.uuid}|${app.team?.url || 'own'}|` : null);
  let writes = 0;
  function prune(db) {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const q = store.count();
    q.onsuccess = () => {
      let extra = q.result - MAX;
      if (extra <= 0) return;
      const c = store.index('at').openKeyCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur || extra-- <= 0) return;
        store.delete(cur.primaryKey);
        cur.continue();
      };
    };
  }
  return {
    async get(path) {
      const s = scope();
      if (!s) return null;
      try {
        const db = await open();
        return await new Promise((resolve) => {
          const q = db.transaction(STORE).objectStore(STORE).get(s + path);
          q.onsuccess = () => resolve(q.result?.blob || null);
          q.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    },
    async put(path, blob) {
      const s = scope();
      if (!s || !blob || blob.size > 4 * 1024 * 1024) return;
      try {
        const db = await open();
        db.transaction(STORE, 'readwrite').objectStore(STORE).put({ blob, at: Date.now() }, s + path);
        if (writes++ % 50 === 0) prune(db);
      } catch {
        /* cache is optional */
      }
    },
    async del(path) {
      const s = scope();
      if (!s) return;
      try {
        (await open()).transaction(STORE, 'readwrite').objectStore(STORE).delete(s + path);
      } catch {
        /* cache is optional */
      }
    },
    async clear(prefix) {
      const db = await open();
      await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(t.error);
      });
    },
  };
})();
