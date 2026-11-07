import { readFontMetadata } from './font-metadata.js';
import { fileFontVersion, fileFontData, fileFontFamily } from './file-fonts.js';
let catalogue, pending, version = 0;
const metadata = new Map();
const key = name => name.trim().toLowerCase();
export const localFontVersion = () => version + fileFontVersion();
function remember(faces) {
  catalogue = faces;
  metadata.clear(); version++;
  return faces;
}
// The picker calls this directly from a user action, allowing the browser's
// permission prompt. No automatic import path requests permission.
export async function browseLocalFonts() {
  return remember(await window.queryLocalFonts());
}
async function authorizedFonts() {
  if (catalogue) return catalogue;
  if (typeof window === 'undefined' || typeof window.queryLocalFonts !== 'function' || !globalThis.navigator?.permissions?.query) return [];
  if (!pending) pending = (async () => {
    try {
      const permission = await navigator.permissions.query({ name: 'local-fonts' });
      if (permission.state !== 'granted') return [];
      return remember(await window.queryLocalFonts());
    } catch { return []; }
    finally { pending = null; }
  })();
  return pending;
}
// Settle the catalog version before dependent font preparation is cached.
// This only uses an existing grant; it never requests permission.
export async function prepareAuthorizedLocalFonts() { await authorizedFonts(); }
async function localSourceFace(source) {
  if (typeof source !== 'string' || !source.startsWith('local(')) return null;
  const faces = await authorizedFonts();
  // local() resolves full/PostScript names. A family match alone can identify
  // the wrong face, especially for named weights and localized families.
  for (const match of source.matchAll(/local\(("(?:\\.|[^"\\])*")\)/g)) {
    let name; try { name = key(JSON.parse(match[1])); } catch { continue; }
    const face = faces.find(f => key(f.fullName || '') === name || key(f.postscriptName || '') === name);
    if (face) return face;
  }
  return null;
}
export async function localSourceFontData(source) {
  try { const face = await localSourceFace(source); return face ? await (await face.blob()).arrayBuffer() : null; }
  catch { return null; }
}
export async function localSourceMetadata(source) {
  const face = await localSourceFace(source);
  if (!face) return null;
  return faceMetadata(face);
}
async function faceMetadata(face) {
  if (!metadata.has(face)) metadata.set(face, (async () => {
    try { return readFontMetadata(await (await face.blob()).arrayBuffer()); }
    catch { return null; }
  })());
  return metadata.get(face);
}
// Inspect only the requested family, after existing browser authorization.
// Full/PostScript aliases can identify a single face rather than a CSS family.
async function familyFaces(name) {
  const faces = await authorizedFonts(), normalized = key(name);
  const family = faces.filter(f => key(f.family || '') === normalized);
  const selected = family.length ? family : faces.filter(f => key(f.fullName || '') === normalized || key(f.postscriptName || '') === normalized);
  return selected;
}
const supplied = name => fileFontData(fileFontFamily(name) || name);
export async function localFamilyMetadata(name) { const files = supplied(name); return files.length ? files.map(face => face.metadata) : Promise.all((await familyFaces(name)).map(faceMetadata)); }
export async function localFamilyFaceMetadata(name) {
  const files = supplied(name); if (files.length) return files.map(({ fullName, metadata }) => ({ fullName, metadata }));
  return Promise.all((await familyFaces(name)).map(async face => ({ fullName: face.fullName, metadata: await faceMetadata(face) })));
}
export async function localFamilyFontData(name) {
  const files = supplied(name); if (files.length) return files;
  return Promise.all((await familyFaces(name)).map(async face => {
    const buffer = await (await face.blob()).arrayBuffer();
    if (!metadata.has(face)) metadata.set(face, Promise.resolve(readFontMetadata(buffer)));
    return { fullName: face.fullName, metadata: await metadata.get(face), buffer };
  }));
}
