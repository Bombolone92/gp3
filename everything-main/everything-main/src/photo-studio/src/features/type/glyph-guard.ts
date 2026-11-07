// Preferences → Type → Enable missing glyph protection: characters the
// current bundled font cannot draw are typed in a bundled font that can.
import { BUNDLED_FONTS, findBundled, loadFontFile } from '../../imaging/text/fonts';
import type { SfntFont } from '../../imaging/text/sfnt';
import { glyphRuns, type GlyphSource } from '../../imaging/text/glyph-runs';

const parsed = new Map<string, SfntFont | null>();
const loading = new Set<string>();
/** A bundled family's character map, loading it in the background on first use. */
function source(family: string): GlyphSource | undefined {
  const b = findBundled(family);
  if (!b) return undefined;
  const f = parsed.get(b.family);
  if (f === undefined && !loading.has(b.family)) {
    loading.add(b.family);
    // The font parser loads with the first font file.
    Promise.all([loadFontFile(b.family, false), import('../../imaging/text/sfnt')])
      .then(([buf, { parseFont }]) => parsed.set(b.family, parseFont(buf)))
      .catch(() => parsed.set(b.family, null));
  }
  return f ? { family: b.family, has: (cp) => f.hasGlyph(cp) } : undefined;
}
/** Start loading the bundled fonts' character maps. */
export function prefetchGlyphMaps() {
  for (const f of BUNDLED_FONTS) source(f.family);
}
/** Typed text split by the font that should draw it (see glyphRuns). */
export function protectGlyphs(text: string, family: string | undefined): [string, string | undefined][] {
  const base = family ? source(family) : undefined;
  if (!base) return [[text, undefined]];
  const fallbacks = BUNDLED_FONTS.map((f) => source(f.family)).filter((f): f is GlyphSource => !!f);
  return glyphRuns(text, base, fallbacks);
}
