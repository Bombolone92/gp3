import { localFamilyFontData, localFontVersion, prepareAuthorizedLocalFonts } from './local-fonts.js';
import { readFontMetadata } from './font-metadata.js';
import { withoutGposOnlyKerning } from './gpos-only-kerning-font.js';
import { repairLegacyKerning, legacyKerningAsPositioning } from './legacy-kerning-font.js';
import { selectKerningSources, requestsOpenTypeKerning } from './opentype-kerning.js';
import { syntheticAdvanceFont } from './synthetic-advance-font.js';
import { usesSyntheticAdvance } from './synthetic-bold.js';
import { syntheticFontSource } from './synthetic-font-source.js';

const policies = new Map();
let serial = 0;
const key = (name, recoveryOnly = false) => `${name.trim().toLowerCase()}/${recoveryOnly}`;
export function legacyGposFamily(style, synthetic = false) {
  if (!(style.kerning > 0) || !style.legacyKerning && requestsOpenTypeKerning(style)) return undefined;
  const policy = policies.get(key(style.fontFamily || style.fontAscii || 'Noto Sans', !style.legacyKerning));
  if (policy?.version !== localFontVersion()) return undefined;
  return synthetic ? policy.syntheticAlias : policy.alias;
}

export async function prepareLegacyGpos(name, sources, prefetched, recoveryOnly = false) {
  const normalized = key(name, recoveryOnly), previous = policies.get(normalized);
  if (previous?.version === localFontVersion()) return previous.promise;
  if (previous) { await previous.promise; if (policies.get(normalized) !== previous) return prepareLegacyGpos(name, sources, undefined, recoveryOnly); }
  const entry = { version: localFontVersion(), faces: [] };
  entry.promise = (async () => {
    try {
      let normal = await (prefetched?.name === normalized && prefetched.signature === JSON.stringify(sources) ? prefetched.promise : prepareNormalFaces(name, sources, recoveryOnly));
      if (normal && normal.version !== localFontVersion()) normal = await prepareNormalFaces(name, sources, recoveryOnly);
      if (!normal) return;
      entry.version = normal.version;
      if (entry.version !== localFontVersion()) return;
      const { available, prepare, alias, syntheticAlias, faces } = normal;
      entry.faces.push(...faces);
      const syntheticStyles = new Set();
      for (const italic of [false, true]) if (usesSyntheticAdvance({ bold: true, italic }, name)) {
        const source = syntheticFontSource(available, italic);
        if (!source) throw new Error('Unavailable synthetic face');
        // An upright source must stay upright so CSS can synthesize oblique.
        const style = source.descriptors.style || 'normal';
        if (syntheticStyles.has(style)) continue;
        // Named semibold aliases retain their source advances. Known light/
        // regular faces still receive the existing synthetic unit even when
        // local enumeration registers their intrinsic weight instead of 400.
        const regular = !source.descriptors.weight || Number(source.descriptors.weight) === 400 ||
          source.metadata.weight === 300 || source.metadata.weight === 400;
        const adjusted = regular ? syntheticAdvanceFont(source.buffer) : source.buffer;
        const data = adjusted && prepare(adjusted);
        if (!data) throw new Error('Unsupported synthetic GPOS face');
        entry.faces.push(await new FontFace(syntheticAlias, data, { ...source.descriptors, weight: '700', style }).load());
        syntheticStyles.add(style);
      }
      if (entry.version !== localFontVersion()) { entry.faces = []; return; }
      entry.faces.forEach(face => document.fonts.add(face));
      entry.alias = alias; entry.syntheticAlias = syntheticAlias;
    } catch { entry.faces.forEach(face => document.fonts.delete(face)); entry.faces = []; }
    finally { previous?.faces.forEach(face => document.fonts.delete(face)); }
  })();
  policies.set(normalized, entry);
  return entry.promise;
}

async function readLegacySources(name, sources) {
  const remote = sources.filter(face => face.source.startsWith('url('));
  return remote.length ? await Promise.all(remote.map(async face => {
    const match = /^url\(("(?:\\.|[^"\\])*")\)$/.exec(face.source);
    if (!match) throw new Error('Unrecognized font source');
    const url = new URL(JSON.parse(match[1]), document.baseURI);
    if (url.origin !== new URL(document.baseURI).origin) throw new Error('Nonlocal font source');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Unavailable font source');
    const buffer = await response.arrayBuffer();
    return { buffer, metadata: readFontMetadata(buffer), descriptors: face.descriptors || {} };
  })) : (await localFamilyFontData(name)).map(face => ({ ...face, descriptors: { weight: String(face.metadata?.weight), style: face.metadata?.italic ? 'italic' : 'normal' } }));
}
// Prepare without registering any face. The caller retains this token only for
// its current load; source signatures and catalog versions guard reuse.
export function prefetchLegacyGpos(name, sources, recoveryOnly = false) {
  if (policies.get(key(name, recoveryOnly))?.version === localFontVersion()) return;
  return { name: key(name, recoveryOnly), signature: JSON.stringify(sources), promise: prepareNormalFaces(name, sources, recoveryOnly).catch(() => null) };
}

async function prepareNormalFaces(name, sources, recoveryOnly = false) {
  await prepareAuthorizedLocalFonts();
  const version = localFontVersion();
  let available = await readLegacySources(name, sources);
  if (!available?.length || available.some(({ metadata: m }) => !m || m.variable)) return;
  const recoverLegacy = available.every(({ metadata: m }) => m.legacyKerning && !m.glyphPositioning);
  if (recoveryOnly && !recoverLegacy) return;
  if (!recoverLegacy && available.some(({ metadata: m }) => m.legacyKerning || !m.glyphPositioning)) return;
  if (recoverLegacy && new Set(available.map(face => face.metadata.widthClass)).size > 1) available = selectKerningSources(available, name);
  // Modern legacy requests recover overflowing tables only. Valid pair tables
  // and GPOS behavior remain untouched; a separate cache prevents a legacy
  // document's stripped-GPOS policy from leaking into a modern document.
  const repaired = recoveryOnly ? new Map(available.map(face => [face.buffer, repairLegacyKerning(face.buffer)])) : null;
  if (recoveryOnly && ![...repaired.values()].some(Boolean)) return;
  const prepare = recoveryOnly ? buffer => repaired.has(buffer) ? repaired.get(buffer) || buffer : repairLegacyKerning(buffer) || buffer :
    recoverLegacy ? buffer => repairLegacyKerning(buffer) || legacyKerningAsPositioning(buffer) : withoutGposOnlyKerning;
  // Do not substitute a width sibling when local enumeration groups faces.
  const widths = new Set(available.map(face => face.metadata.widthClass));
  if (widths.size !== 1) return;
  const alias = `Canvas legacy GPOS ${++serial}`, syntheticAlias = `${alias} synthetic`;
  const faces = [];
  for (const source of available) {
    const data = prepare(source.buffer);
    if (!data) throw new Error('Unsupported GPOS feature table');
    faces.push(await new FontFace(alias, data, source.descriptors).load());
  }

  return { available, prepare, alias, syntheticAlias, faces, version };
}
