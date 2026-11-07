/**
 * Document files live in the app's own Puter folder, never in KV. A document
 * record keeps only a small reference: { path, name, type, size }.
 *
 *   docs/<matterId or "firm">/<id>-<name>
 *
 * In a shared firm, files are kept in the owner's drive and go through the
 * team server. In the demo there is no cloud, so files live in memory for
 * the session.
 */
import { app } from './app.js';
import { newId } from './core/ids.js';
import { call } from './team.js';

export const MAX_BYTES = 50 * 1024 * 1024;
export const TEAM_MAX_BYTES = 8 * 1024 * 1024; // what the team server accepts per file
const memory = new Map(); // demo: path -> Blob
const urlCache = new Map(); // path -> object URL

function safeName(name) {
  return (
    String(name || 'file')
      .replace(/[^\w.\- ]+/g, '_')
      // The team server refuses ".." anywhere in a path.
      .replace(/\.{2,}/g, '.')
      .slice(-100) || 'file'
  );
}

/** Store one Blob or File; resolves the file reference. */
export async function saveFile(file, { folder = 'firm', name } = {}) {
  const fileName = name || file.name || 'document';
  if (file.size > MAX_BYTES) throw new Error(`${fileName} is larger than 50 MB.`);
  if (app.team?.url && file.size > TEAM_MAX_BYTES) throw new Error(`${fileName} is larger than 8 MB, the limit for files in a shared firm.`);
  const path = `docs/${safeName(folder)}/${newId()}-${safeName(fileName)}`;
  const type = file.type || guessType(fileName);
  if (app.demo || typeof puter === 'undefined') {
    memory.set(path, file);
  } else if (app.team?.url) {
    await call(app.team.url, 'fileWrite', { path, data: await toBase64(file), type }, { timeoutMs: 120000 });
  } else {
    await puter.fs.write(path, file, { createMissingParents: true, overwrite: true });
  }
  return { path, name: fileName, type, size: file.size };
}

export async function readFile(ref) {
  let blob = memory.get(ref.path);
  if (!blob && typeof ref.demoText === 'string') blob = new Blob([ref.demoText], { type: 'text/plain' });
  if (!blob) {
    if (app.demo || typeof puter === 'undefined') throw new Error('This file is not available in the demo.');
    if (app.team?.url) {
      const out = await call(app.team.url, 'fileRead', { path: ref.path }, { timeoutMs: 120000 });
      blob = new Blob([fromBase64(out.data)], { type: ref.type || out.type || '' });
    } else blob = await puter.fs.read(ref.path);
  }
  if (ref.type && blob.type !== ref.type) blob = new Blob([blob], { type: ref.type });
  return blob;
}

// Object URLs share the app's origin, so opening one as a page (in a frame or
// a new tab) runs its scripts with the person's Puter session. Only passive
// types keep their type; SVG becomes a data: URL, which has no origin.
const PASSIVE_TYPES = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf)$/i;

/** URL for viewing a file. Cached for the session. */
export async function fileUrl(ref) {
  if (urlCache.has(ref.path)) return urlCache.get(ref.path);
  let blob = await readFile(ref);
  let url;
  if (/^image\/svg\+xml$/i.test(blob.type)) url = `data:image/svg+xml;base64,${await toBase64(blob)}`;
  else {
    if (!PASSIVE_TYPES.test(blob.type)) blob = new Blob([blob], { type: 'application/octet-stream' });
    url = URL.createObjectURL(blob);
  }
  urlCache.set(ref.path, url);
  return url;
}

export async function deleteFile(ref) {
  memory.delete(ref.path);
  const url = urlCache.get(ref.path);
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  urlCache.delete(ref.path);
  // Sample documents carry their text and have no stored file.
  if (app.demo || typeof puter === 'undefined' || typeof ref.demoText === 'string') return;
  if (app.team?.url) {
    await call(app.team.url, 'fileDelete', { path: ref.path });
    return;
  }
  try {
    await puter.fs.delete(ref.path);
  } catch (err) {
    // Already gone is fine.
    if (!/not.?found|subject_does_not_exist/i.test(String(err?.code || err?.message || err))) throw err;
  }
}

export function isPreviewable(type) {
  return /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf|text\/(plain|html|csv|markdown))$/i.test(type || '');
}

export function guessType(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return (
    {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      html: 'text/html',
      htm: 'text/html',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      eml: 'message/rfc822',
    }[ext] || 'application/octet-stream'
  );
}

/** Icon name for a file type. */
export function fileIcon(type, name = '') {
  if (/^image\//.test(type)) return 'image';
  if (/pdf/.test(type)) return 'file';
  if (/sheet|excel|csv/.test(type) || /\.(xlsx?|csv)$/i.test(name)) return 'file-spreadsheet';
  return 'file-blank';
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
