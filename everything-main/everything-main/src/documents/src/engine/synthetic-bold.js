import { cssFontString } from './font-families.js';
import { localSourceMetadata } from './local-fonts.js';

const synthetic = new Set();
const advanceCandidates = new Set();
let serial = 0;
const key = (name, italic) => `${name.trim().toLowerCase()}/${!!italic}`;
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

// A native bold face must not be replaced merely because its advances happen
// to equal regular. Require identical ink to the browser's forced synthesis,
// matching regular ink, and an actual difference between regular and bold.
// Verified non-bold faces also need synthesis when the browser suppresses bold
// entirely. Local metadata is inspected only with existing user permission.
export function isSynthesizedInk(regular, bold, aliasRegular, aliasBold, regularMatches = same(regular, aliasRegular), registeredNormalOnly = false) {
  return regular.length > 0 && regularMatches && same(bold, aliasBold) && (!same(regular, bold) || registeredNormalOnly);
}

// The synthetic outline is distinct from its synthetic glyph advance.
// Identical-outline native controls vary only OS/2 weight: only the light
// (300) and normal (400) values receive the outline, including at adjacent
// weight boundaries. Unknown or variable faces retain raster detection.
export function permitsSyntheticStroke(metadata) {
  return !metadata || metadata.variable || !metadata.bold && (metadata.weight === 300 || metadata.weight === 400);
}

export const usesSyntheticBold = (style, family) => Boolean(style.bold && !style.textOutline?.width && synthetic.has(key(family, style.italic)));
export const usesSyntheticAdvance = (style, family) => Boolean(style.bold && advanceCandidates.has(key(family, style.italic)));

// Called once while resolving a document font, never during layout or paint.
// Only the requested font is inspected; the temporary face is always removed.
// Unknown/local-load failures keep the browser's existing behavior.
export async function probeSyntheticBold(name, source, descriptors = {}, registeredNormalOnly = false) {
  let face;
  let regularMismatch = false;
  try {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 96;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx?.getImageData || !ctx.fillText || typeof FontFace === 'undefined') return;
    const alias = `Canvas synthesis probe ${++serial}`;
    face = await new FontFace(alias, source, { ...descriptors, weight: '400' }).load();
    document.fonts.add(face);
    const ink = (family, italic, bold) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${italic ? 'italic' : 'normal'} ${bold ? 700 : 400} 48px ${cssFontString(family)}`;
      ctx.fontKerning = 'none'; ctx.fillText('Hamburgefontsiv MW0123', 8, 68);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      return alpha;
    };
    let localMetadata;
    for (const italic of descriptors.style === 'italic' ? [true] : [false, true]) {
      const regular = ink(name, italic, false), aliasRegular = ink(alias, italic, false);
      // A font without these glyphs can fall back to an ordinary real-bold
      // family in both samples. That is not evidence of synthetic bold.
      if (same(aliasRegular, ink(`${alias} absent`, italic, false))) continue;
      const matches = same(regular, aliasRegular);
      if (!italic) regularMismatch = !matches;
      // Both synthesis predicates require matching regular ink. Clear an old
      // decision before skipping bold samples that cannot change the result.
      synthetic.delete(key(name, italic));
      advanceCandidates.delete(key(name, italic));
      if (!matches) continue;
      const bold = ink(name, italic, true), aliasBold = ink(alias, italic, true);
      let normalOnly = registeredNormalOnly;
      if (matches && same(bold, aliasBold) && localMetadata === undefined) localMetadata = await localSourceMetadata(source);
      if (!normalOnly && matches && same(regular, bold) && same(bold, aliasBold)) {
        normalOnly = !!(localMetadata && !localMetadata.variable && !localMetadata.bold && localMetadata.weight <= 400);
      }
      if (permitsSyntheticStroke(localMetadata) && isSynthesizedInk(regular, bold, aliasRegular, aliasBold, matches, normalOnly)) synthetic.add(key(name, italic));
      // The advance and the stroke are separate decisions: a semibold
      // face can retain fill-only ink but still receive the extra glyph unit.
      if (isSynthesizedInk(regular, bold, aliasRegular, aliasBold, matches, true)
        && (!localMetadata || !localMetadata.variable && !localMetadata.bold && localMetadata.weight < 700)) advanceCandidates.add(key(name, italic));
    }
  } catch { /* Detection is optional; do not make an available font fail. */ }
  finally { if (face) document.fonts.delete(face); }
  return regularMismatch;
}
