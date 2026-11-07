import { readFontFileInfo } from './font-file-info.js';
import { normalizeFontBuffer } from './font-container.js';

const faces = new Map(), names = new Map(), aliases = new Map();
let serial = 0, version = 0, retainedBytes = 0, pending = Promise.resolve();
const key = name => name.trim().toLowerCase();
export const fileFontVersion = () => version;
export const fileFontFamily = name => names.size && typeof name === 'string' ? names.get(key(name)) : undefined;
export const fileFontNames = () => [...new Set([...faces.values()].flatMap(face => [face.info.family, face.info.legacyFamily]))].sort((a, b) => a.localeCompare(b));
export const fileFontSources = name => aliases.size && typeof name === 'string' ? aliases.get(key(name))?.sources : undefined;
// Only generated picture SVGs consume these bytes; source assets and DOCX
// font declarations remain untouched.
export const fileFontImageSources = name => aliases.size && typeof name === 'string' ? aliases.get(names.get(key(name)) || key(name))?.imageSources : undefined;
export const fileFontData = name => aliases.get(key(name))?.faces.map(face => ({ fullName: face.info.fullName, metadata: face.info.metadata, buffer: face.buffer })) || [];

function descriptors(info, name) {
  if (!info.familyNames.some(n => key(n) === key(name))) {
    // Legacy style-linking families and exact face names are separate from
    // extended typographic families (OpenType name IDs 1 and 16).
    return info.legacyNames.some(n => key(n) === key(name)) ? { ...(info.metadata.bold ? { weight: '700' } : {}), style: info.metadata.italic ? 'italic' : 'normal' } : {};
  }
  const { metadata: m, axes: a } = info;
  const result = { weight: a.wght ? `${a.wght.min} ${a.wght.max}` : String(m.weight), style: m.italic ? 'italic' : 'normal' };
  const widths = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200];
  result.stretch = a.wdth ? `${a.wdth.min}% ${a.wdth.max}%` : `${widths[m.widthClass - 1] || 100}%`;
  if (a.wght && (a.wght.min < 1 || a.wght.max > 1000) || a.wdth && (a.wdth.min <= 0 || a.wdth.max > 1000)) throw new Error('The font has a variation range CSS cannot represent.');
  if (a.slnt && !a.ital) result.style = `oblique ${-a.slnt.max}deg ${-a.slnt.min}deg`;
  return result;
}

async function loadOne(file) {
  if (!file || file.size > 32 * 1024 * 1024) throw new Error('Choose a font file no larger than 32 MB.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > 32 * 1024 * 1024) throw new Error('Choose a font file no larger than 32 MB.');
  const info = readFontFileInfo(buffer), id = key(info.postscriptName);
  const normalized = normalizeFontBuffer(buffer);
  const storageBytes = buffer.byteLength + (normalized === buffer ? 0 : normalized.byteLength);
  const old = faces.get(id);
  const previousBytes = old && new Uint8Array(old.buffer);
  if (old && buffer.byteLength === old.buffer.byteLength && new Uint8Array(buffer).every((byte, i) => byte === previousBytes[i])) return { family: info.family, duplicate: true };
  // Previous aliases remain valid for already open documents/probes. Bound
  // their total lifetime storage, and release everything on browser reload.
  if (retainedBytes + storageBytes > 128 * 1024 * 1024) throw new Error('This browser session has loaded 128 MB of fonts. Reload to start a new session.');
  const woff = normalized !== buffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: woff ? 'font/woff' : 'font/ttf' })), face = { buffer, info, url };
  const candidate = new Map(faces); candidate.set(id, face);
  const fontNames = info => [...info.familyNames, ...info.legacyNames, ...info.exactNames];
  const affected = new Set([...fontNames(info), ...(old ? fontNames(old.info) : [])].map(key));
  const groups = [];
  try {
    for (const name of affected) {
      let selected = [...candidate.values()].filter(f => f.info.familyNames.some(n => key(n) === name));
      if (!selected.length) selected = [...candidate.values()].filter(f => f.info.legacyNames.some(n => key(n) === name));
      if (!selected.length) selected = [...candidate.values()].filter(f => f.info.exactNames.some(n => key(n) === name));
      if (!selected.length) { groups.push({ name }); continue; }
      const alias = `Canvas file font ${++serial}`, sources = [], imageSources = [], loaded = [];
      for (const f of selected) {
        const d = descriptors(f.info, name), variants = [d];
        if (f.info.familyNames.some(n => key(n) === name) && f.info.axes.ital?.min === 0 && f.info.axes.ital.max >= 1) variants.push({ ...d, style: d.style === 'italic' ? 'normal' : 'italic' });
        for (const descriptor of variants) {
          const source = `url(${JSON.stringify(f.url)})`;
          loaded.push(await new FontFace(alias, source, descriptor).load());
          sources.push({ source, descriptors: descriptor });
          imageSources.push({ buffer: f.buffer, descriptors: descriptor });
        }
      }
      groups.push({ name, alias, sources, imageSources, loaded, faces: selected });
    }
  } catch (error) { URL.revokeObjectURL(url); throw new Error(`The font could not be loaded: ${error.message}`); }
  // Publish only after the complete family validates. Failed files never
  // replace a working face or leave a half-registered family behind.
  for (const group of groups) {
    if (!group.alias) { names.delete(group.name); continue; }
    group.loaded.forEach(font => document.fonts.add(font));
    aliases.set(key(group.alias), group); names.set(group.name, key(group.alias));
  }
  faces.set(id, face); retainedBytes += storageBytes; version++;
  return { family: info.family, duplicate: false };
}

// Serialize overlapping file selections without making one rejected file
// prevent the next selection from loading.
export function loadFontFile(file) {
  const result = pending.then(() => loadOne(file));
  pending = result.catch(() => {});
  return result;
}
