/**
 * Fonts the user uploads (TTF, OTF, WOFF, WOFF2). The file is stored next
 * to the project's media at fonts/<hash>.<ext>, listed in project.fonts and
 * registered with the browser under a unique family name, so text styles,
 * the preview and exports all use it. Opening a project registers its
 * fonts again.
 */
import { fingerprint, uid } from '../lib/ids.js';
import { registerFont, isFontRegistered } from '../engine/font-registry.js';

export const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'];
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
export const MAX_FONT_BYTES = 20 * 1024 * 1024;

const MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

export const fontPath = (f) => `fonts/${f.hash}.${f.ext}`;

/** Display name from a file name: "My-Font_Bold.ttf" -> "My Font Bold". */
export function fontNameOf(fileName) {
  const base = String(fileName || 'Font').replace(/\.[^.]+$/, '');
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Font';
}

/** CSS family for an uploaded font; the hash keeps two files with one name apart. */
export function familyFor(name, hash) {
  const clean = name.replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 40) || 'Font';
  return `${clean} ${hash.slice(0, 6)}`;
}

/**
 * Check, register and store a font file. Returns the project font entry
 * { id, family, name, hash, ext, mime, size } (an existing entry when the
 * same file was uploaded before). Throws with a readable message.
 */
export async function importFontFile(library, file, existing = []) {
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  if (!FONT_EXTS.includes(ext)) throw new Error('Choose a TTF, OTF, WOFF or WOFF2 font file.');
  if (file.size > MAX_FONT_BYTES) throw new Error('This font file is too large (20 MB at most).');
  const hash = await fingerprint(file);
  const same = existing.find((f) => f.hash === hash);
  if (same) {
    await ensureFont(library, same, file);
    return same;
  }
  const name = fontNameOf(file.name);
  const entry = { id: uid('f'), family: familyFor(name, hash), name, hash, ext, mime: MIME[ext], size: file.size };
  try {
    await registerFont(entry.family, await file.arrayBuffer());
  } catch {
    throw new Error(`${file.name} is not a font this browser can read.`);
  }
  await library.backend.writeBlob(fontPath(entry), file);
  return entry;
}

async function ensureFont(library, f, blob = null) {
  if (isFontRegistered(f.family)) return;
  const data = blob || (await library.backend.readBlob(fontPath(f)));
  if (!data) throw new Error(`Font file missing: ${f.name}`);
  await registerFont(f.family, await data.arrayBuffer());
}

/** Register every uploaded font of a project (on open, undo, redo). Missing files are skipped. */
export async function syncProjectFonts(library, project) {
  const list = project?.fonts || [];
  await Promise.all(list.map((f) => ensureFont(library, f).catch((err) => console.warn(err))));
}
