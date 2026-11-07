import { syntheticAdvanceFont } from './synthetic-advance-font.js';
import { localSourceFontData } from './local-fonts.js';
import { syntheticFontSource } from './synthetic-font-source.js';
import { readFontMetadata } from './font-metadata.js';
const faces = new Map(), aliases = new Map();
let serial = 0;
const key = (name, italic) => `${name.trim().toLowerCase()}/${!!italic}`;
export const syntheticAdvanceFamily = (name, italic) => aliases.get(key(name, italic));
async function sourceData(source) {
  if (source.startsWith('local(')) return localSourceFontData(source);
  const match = /^url\(("(?:\\.|[^"\\])*")\)$/.exec(source);
  if (!match) return null;
  const url = new URL(JSON.parse(match[1]), document.baseURI);
  if (url.origin !== new URL(document.baseURI).origin) return null;
  const response = await fetch(url);
  return response.ok ? response.arrayBuffer() : null;
}
export async function prepareSyntheticAdvance(name, sources, synthesized) {
  for (const italic of [false, true]) {
    const target = key(name, italic);
    if (!synthesized(italic)) { aliases.delete(target); continue; }
    const normal = sources.filter(f => !f.descriptors?.weight || [300,400].includes(Number(f.descriptors.weight)));
    const face = syntheticFontSource(normal, italic);
    if (!face) continue;
    const cacheKey = JSON.stringify([face.source, face.descriptors || {}]);
    if (!faces.has(cacheKey)) faces.set(cacheKey, (async () => {
      try {
        const original = await sourceData(face.source);
        // A new intrinsic-light registration must be a verified light face.
        // Keep the existing regular-source policy; semibold retains its own
        // advances and never enters this additional-unit preparation path.
        if (Number(face.descriptors?.weight) === 300 && readFontMetadata(original)?.weight !== 300) return null;
        const data = original && syntheticAdvanceFont(original);
        if (!data) return null;
        const family = `Canvas synthetic advance ${++serial}`;
        // Declare the face as bold so the browser does not synthesize it again,
        // while missing glyphs still select the ordinary bold fallback family.
        const loaded = await new FontFace(family, data, { ...face.descriptors, weight: '700' }).load();
        document.fonts.add(loaded);
        return family;
      } catch { return null; }
    })());
    const family = await faces.get(cacheKey);
    if (family) aliases.set(target, family);
    else { faces.delete(cacheKey); aliases.delete(target); }
  }
}
