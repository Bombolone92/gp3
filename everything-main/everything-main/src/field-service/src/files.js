/**
 * Attachments (receipts, job photos, documents) live in the app's own
 * Puter folder, never in KV. Records only keep a small reference:
 *   { id, name, type, size, path, createdAt }
 *
 * Photos are downscaled in the browser before upload so a 12 MP phone
 * picture becomes a few hundred kilobytes.
 *
 * In the demo there is no cloud, so files live in memory for the session.
 */
import { app } from './app.js';
import { newId } from './core/ids.js';
import { call } from './team.js';

const MAX_EDGE = 2000;
const MAX_BYTES = 25 * 1024 * 1024;
export const TEAM_MAX_BYTES = 8 * 1024 * 1024; // what the team server accepts per file
const memory = new Map(); // demo: path -> Blob
const urlCache = new Map(); // path -> object URL
const loading = new Map(); // path -> promise of an object URL

// Types every browser can show. HEIC is converted to JPEG on upload where the
// browser can decode it, and otherwise kept as a plain file.
export function isImage(type) {
  return /^image\/(png|jpe?g|webp|gif|avif)$/i.test(type || '');
}

/** Resize large raster images; returns a Blob (or the original file). */
export async function shrinkImage(file) {
  if (!/^image\/(png|jpe?g|webp|heic|heif)$/i.test(file.type) || typeof createImageBitmap !== 'function') return file;
  const heic = /heic|heif/i.test(file.type);
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && !heic) {
      bmp.close?.();
      return file;
    }
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type, quality: 0.85 }) : await new Promise((r) => canvas.toBlob(r, type, 0.85));
    return blob && (heic || blob.size < file.size) ? blob : file;
  } catch {
    return file;
  }
}

function safeName(name) {
  // No ".." anywhere: the team server refuses any path containing it.
  return String(name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '.').slice(-80) || 'file';
}

/** Upload one File; resolves the attachment reference. */
export async function saveFile(file, folder = 'files') {
  // Checked after shrinking: a 40 MB phone photo becomes a few hundred KB.
  const blob = await shrinkImage(file);
  if (blob.size > MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  if (app.team?.url && blob.size > TEAM_MAX_BYTES) throw new Error(`${file.name} is larger than 8 MB, the limit for files in a shared business.`);
  const id = newId();
  const name = safeName(file.name);
  const path = `${folder}/${id}-${name}`;
  if (app.demo || typeof puter === 'undefined') {
    memory.set(path, blob);
  } else if (app.team?.url) {
    // Team businesses keep files in the owner's drive, through the worker.
    await call(app.team.url, 'fileWrite', { path, data: await toBase64(blob), type: blob.type || file.type || '' }, { timeoutMs: 120000 });
  } else {
    await puter.fs.write(path, blob, { createMissingParents: true, overwrite: true });
  }
  return { id, name: file.name, type: blob.type || file.type, size: blob.size, path, createdAt: new Date().toISOString() };
}

/** Object URL for viewing an attachment. Cached for the session. */
export async function fileUrl(att) {
  if (urlCache.has(att.path)) return urlCache.get(att.path);
  // A thumbnail redrawn, or opened, while it is still downloading shares
  // that download instead of starting another.
  if (!loading.has(att.path)) loading.set(att.path, loadUrl(att).finally(() => loading.delete(att.path)));
  return loading.get(att.path);
}

async function loadUrl(att) {
  let blob = memory.get(att.path);
  if (!blob) {
    if (app.demo || typeof puter === 'undefined') throw new Error('File not available');
    if (app.team?.url) {
      const out = await call(app.team.url, 'fileRead', { path: att.path }, { timeoutMs: 120000 });
      blob = new Blob([fromBase64(out.data)], { type: att.type || out.type || '' });
    } else blob = await puter.fs.read(att.path);
  }
  if (att.type && blob.type !== att.type) blob = new Blob([blob], { type: att.type });
  const url = URL.createObjectURL(blob);
  urlCache.set(att.path, url);
  return url;
}

export async function deleteFile(att) {
  memory.delete(att.path);
  const url = urlCache.get(att.path);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(att.path);
  if (!app.demo && app.team?.url) {
    await call(app.team.url, 'fileDelete', { path: att.path });
  } else if (!app.demo && typeof puter !== 'undefined') {
    try {
      await puter.fs.delete(att.path);
    } catch (err) {
      // Already gone is fine.
      if (!/not.?found|subject_does_not_exist/i.test(String(err?.code || err?.message || err))) throw err;
    }
  }
}

/**
 * Delete the files attached to records that were deleted, except any still
 * attached elsewhere (copies made by older versions shared their files).
 * Never throws.
 */
export function deleteAttachments(records) {
  const inUse = filesInUse();
  for (const rec of records) for (const att of rec?.attachments || []) if (!inUse.has(att.path)) deleteFile(att).catch(() => {});
}

/** Paths of every file a record still points to. */
export function filesInUse() {
  const store = app.store;
  const inUse = new Set();
  for (const coll of ['clients', 'requests', 'quotes', 'jobs', 'invoices']) for (const r of store.all(coll)) for (const a of r.attachments || []) inUse.add(a.path);
  for (const x of store.all('expenses')) if (x.receipt) inUse.add(x.receipt.path);
  return inUse;
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
