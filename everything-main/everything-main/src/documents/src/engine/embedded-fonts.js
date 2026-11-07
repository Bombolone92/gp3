import { parseXml } from './docx-xml.js';
import { relatedPartPath } from './docx-relationships.js';
import { readFontMetadata } from './font-metadata.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const C = 'http://schemas.openxmlformats.org/package/2006/content-types';
const obfuscated = 'application/vnd.openxmlformats-officedocument.obfuscatedFont';
const forms = { embedRegular: {}, embedBold: { weight: '700' }, embedItalic: { style: 'italic' }, embedBoldItalic: { weight: '700', style: 'italic' } };
const packages = new WeakMap(), families = new Map(), aliases = new Map();
let serial = 0;

// The GUID's bytes are reversed as a whole (not Windows GUID field ordering).
// Work on a copy: neither font parts nor their source obfuscation are rewritten.
export function decodeEmbeddedFont(bytes, key, type) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32 || !/^\{[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\}$/i.test(key || '')) return null;
  if (type !== obfuscated && type !== 'application/x-font-ttf') return null;
  if (type !== obfuscated && key !== '{00000000-0000-0000-0000-000000000000}') return null;
  const data = bytes.slice(), octets = key.slice(1, -1).replaceAll('-', '').match(/../g).map(v => parseInt(v, 16)).reverse();
  for (let i = 0; i < 32; i++) data[i] ^= octets[i % 16];
  if (!readFontMetadata(data.buffer)) return null;
  const view = new DataView(data.buffer);
  let permissions = 0;
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    if (view.getUint32(at) === 0x4f532f32) permissions = view.getUint16(view.getUint32(at + 8) + 8);
  }
  // Restricted embedding and bitmap-only outlines cannot be used here.
  if (permissions & 0x200 || permissions & 2 && !(permissions & 12)) return null;
  return { data, previewOnly: !!(permissions & 4) && !(permissions & 8) };
}

function targetPath(base, target) {
  if (!target || /[\\?#:\s]/.test(target) || target.startsWith('//') || /%(?![\da-f]{2})|%2f|%5c/i.test(target)) return null;
  const path = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const encoded of target.replace(/^\//, '').split('/')) {
    let segment; try { segment = decodeURIComponent(encoded); } catch { return null; }
    if (segment === '..') { if (!path.length) return null; path.pop(); }
    else if (segment !== '.') { if (!segment || /[\\/\u0000]/.test(segment)) return null; path.push(segment); }
  }
  return path.join('/');
}

// Content comparison, not just a hash, protects document isolation. Reopening
// identical packages reuses the already prepared CSS family and font probes.
function register(faces) {
  let hash = 2166136261;
  for (const face of faces) for (const byte of face.data) hash = Math.imul(hash ^ byte, 16777619);
  const signature = `${hash >>> 0}/${faces.map(f => `${JSON.stringify(f.descriptors)}/${f.data.length}`).join('/')}`;
  const bucket = families.get(signature) || [];
  let family = bucket.find(f => f.faces.every((face, i) => face.data.every((byte, j) => byte === faces[i].data[j])));
  if (!family) {
    family = { alias: `Canvas embedded font ${++serial}`, faces };
    bucket.push(family); families.set(signature, bucket); aliases.set(family.alias.toLowerCase(), family);
  }
  return family.alias;
}

export const isEmbeddedFont = name => aliases.has(name.trim().toLowerCase());
export const embeddedPreviewOnly = name => aliases.get(name.trim().toLowerCase())?.faces.some(face => face.previewOnly) || false;
export function embeddedFontSources(name) {
  const family = aliases.get(name.trim().toLowerCase());
  if (!family) return null;
  return family.faces.map(face => {
    face.url ||= URL.createObjectURL(new Blob([face.data], { type: 'font/ttf' }));
    return { source: `url(${JSON.stringify(face.url)})`, descriptors: face.descriptors };
  });
}

export function documentEmbeddedFonts(parts) {
  if (packages.has(parts)) return packages.get(parts);
  const result = new Map(); packages.set(parts, result);
  const path = relatedPartPath(parts, 'fontTable');
  if (!path) return result;
  const slash = path.lastIndexOf('/'), relPath = path.slice(0, slash + 1) + '_rels/' + path.slice(slash + 1) + '.rels';
  if (!parts[relPath]) return result;
  const nodes = [...parseXml(parts[path]).documentElement.children];
  const relationships = [...parseXml(parts[relPath]).documentElement.children];
  const types = [...parseXml(parts['[Content_Types].xml']).documentElement.children].filter(n => n.namespaceURI === C);
  for (const node of nodes.filter(n => n.namespaceURI === W && n.localName === 'font')) {
    const name = node.getAttributeNS(W, 'name')?.trim().toLowerCase();
    if (!name) continue;
    const faces = [];
    for (const [form, descriptors] of Object.entries(forms)) {
      const declarations = [...node.children].filter(n => n.namespaceURI === W && n.localName === form);
      if (declarations.length !== 1) continue;
      const declaration = declarations[0], id = declaration.getAttributeNS(R, 'id');
      const rels = relationships.filter(n => n.namespaceURI === P && n.localName === 'Relationship' && n.getAttribute('Id') === id);
      if (rels.length !== 1 || rels[0].getAttribute('Type') !== R + '/font' || ![null, 'Internal'].includes(rels[0].getAttribute('TargetMode'))) continue;
      const target = targetPath(path, rels[0].getAttribute('Target'));
      if (!target || !Object.hasOwn(parts, target)) continue;
      const overrides = types.filter(n => n.localName === 'Override' && n.getAttribute('PartName') === '/' + target);
      const defaults = types.filter(n => n.localName === 'Default' && n.getAttribute('Extension')?.toLowerCase() === target.split('.').at(-1).toLowerCase());
      const matches = overrides.length ? overrides : defaults;
      if (matches.length !== 1) continue;
      const face = decodeEmbeddedFont(parts[target], declaration.getAttributeNS(W, 'fontKey'), matches[0].getAttribute('ContentType'));
      if (face) faces.push({ ...face, descriptors });
    }
    if (faces.length) {
      // Ambiguous duplicate declarations must not bind one document's family
      // to an arbitrary face. Preserve their source and use ordinary fallback.
      result.set(name, result.has(name) ? null : register(faces));
    }
  }
  return result;
}
