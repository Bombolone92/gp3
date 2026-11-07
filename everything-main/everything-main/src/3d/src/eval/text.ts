// Text objects: converts the body string into Bézier outlines using a loaded font.
// The font provider is registered at runtime (see io/fonts.ts); until it is ready
// text objects evaluate to no geometry and request a redraw once loaded.
import type { CurveData, Spline } from '../data/types';

export interface GlyphProvider {
  /** Returns outline splines (font units scaled to 1 = em) for a string, laid out. */
  layout(cu: CurveData): Spline[];
}

let provider: GlyphProvider | null = null;
export function setGlyphProvider(p: GlyphProvider) {
  provider = p;
}

export function textToCurves(cu: CurveData): Spline[] {
  return provider ? provider.layout(cu) : [];
}
