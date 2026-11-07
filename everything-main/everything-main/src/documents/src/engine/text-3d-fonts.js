import { localFamilyFontData, localSourceFontData, localFontVersion } from './local-fonts.js';
import { displayedFont, canvasFontSources } from './font-availability.js';
import { readFontMetadata } from './font-metadata.js';
import { normalizeFontBuffer } from './font-container.js';
import { usesSyntheticBold } from './synthetic-bold.js';

const faces = new Map(), families = new Map();
const key = style => `${(style.fontFamily || style.fontAscii || '').trim().toLowerCase()}/${!!style.bold}/${!!style.italic}`;
let parser;
export const preparedText3dFont = style => faces.get(key(style))?.face || null;

async function sourceFaces(name) {
  const installed = await localFamilyFontData(name);
  if (installed.length) return installed;
  const sources = await Promise.all(canvasFontSources(name).map(async ({ source }) => {
    let buffer;
    if (source.startsWith('local(')) buffer = await localSourceFontData(source);
    else {
      const match = /^url\(("(?:\\.|[^"\\])*")\)$/.exec(source);
      if (!match) return null;
      const url = new URL(JSON.parse(match[1]), document.baseURI);
      if (url.origin !== new URL(document.baseURI).origin) return null;
      const response = await fetch(url);
      if (response.ok) buffer = await response.arrayBuffer();
    }
    return buffer ? { buffer, metadata: readFontMetadata(buffer) } : null;
  }));
  return sources.filter(Boolean);
}

function selectFace(sources, style) {
  const available = sources.filter(s => s.metadata && !s.metadata.variable);
  const base = available.find(s => s.fullName?.toLowerCase() === style.fontFamily.toLowerCase()) ||
    available.find(s => s.metadata.weight === 400 && !s.metadata.italic && s.metadata.widthClass === 5) || available[0];
  if (!base) return null;
  const width = base.metadata.widthClass, target = style.bold ? 700 : 400;
  const candidates = available.filter(s => s.metadata.widthClass === width);
  const styled = candidates.filter(s => s.metadata.italic === !!style.italic);
  // Preserve an exact full-face alias; do not borrow a different width/weight
  // from a family merely because it is present in the local-font catalogue.
  return (styled.length ? styled : candidates.filter(s => !s.metadata.italic)).sort((a, b) =>
    Math.abs(a.metadata.weight - target) - Math.abs(b.metadata.weight - target))[0] || null;
}

export async function prepareText3dFonts(styles, alternatives) {
  let changed = false;
  for (const requested of styles) {
    const name = displayedFont(requested, alternatives), style = { ...requested, fontFamily: name };
    const id = key(style), previous = faces.get(id);
    if (previous?.version === localFontVersion()) {
      if (previous.pending) changed = await previous.pending || changed;
      continue;
    }
    const entry = { version: localFontVersion(), face: null };
    faces.set(id, entry);
    entry.pending = (async () => {
      try {
        let family = families.get(name);
        if (!family || family.version !== localFontVersion()) {
          const sources = await sourceFaces(name);
          family = { version: localFontVersion(), sources };
          families.set(name, family);
        }
        const selected = selectFace(family.sources, style);
        if (!selected) return false;
        parser ||= import('../vendor/opentype/opentype.mjs');
        selected.font ||= (await parser).parse(normalizeFontBuffer(selected.buffer));
        entry.face = { font: selected.font, syntheticBold: usesSyntheticBold(style, name),
          syntheticItalic: !!style.italic && !selected.metadata.italic };
      } catch { /* Outline access is optional; native Canvas text remains available. */ }
      finally { entry.version = localFontVersion(); }
      return !!entry.face;
    })();
    changed = await entry.pending || changed;
    entry.pending = null;
  }
  return changed;
}
