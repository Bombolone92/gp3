/**
 * Which OpenType features a character style turns on, as feature tags and as
 * CSS font-feature-settings (for export). Pure: no font access.
 */

/** True when a character style asks for anything beyond the canvas defaults. */
export function needsShaping(st) {
  return (
    st.ligatures === false ||
    st.contextual === false ||
    Boolean(st.discretionary) ||
    Boolean(st.swash) ||
    Boolean(st.stylistic) ||
    Boolean(st.stylisticSets && st.stylisticSets.length) ||
    Boolean(st.titling) ||
    Boolean(st.ordinals) ||
    Boolean(st.fractions) ||
    (st.figures && st.figures !== 'default') ||
    (st.otPosition && st.otPosition !== 'default') ||
    st.altGlyph != null
  );
}

const FIGURES = {
  'tabular-lining': ['tnum', 'lnum'],
  'proportional-lining': ['pnum', 'lnum'],
  'proportional-oldstyle': ['pnum', 'onum'],
  'tabular-oldstyle': ['tnum', 'onum'],
};

/** OpenType feature tags a style enables (the defaults ccmp/liga/clig/calt/rlig included). */
export function featureTags(st) {
  const tags = ['rlig'];
  if (st.ligatures !== false) tags.push('liga');
  if (st.contextual !== false) tags.push('clig', 'calt');
  if (st.discretionary) tags.push('dlig');
  if (st.swash) tags.push('swsh');
  if (st.stylistic) tags.push('salt');
  for (const n of st.stylisticSets || []) tags.push(ssTag(n));
  if (st.titling) tags.push('titl');
  if (st.ordinals) tags.push('ordn');
  if (st.fractions) tags.push('frac');
  tags.push(...(FIGURES[st.figures] || []));
  if (st.otPosition && st.otPosition !== 'default') tags.push(st.otPosition);
  return tags;
}

export const ssTag = (n) => `ss${String(n).padStart(2, '0')}`;

/** CSS font-feature-settings for a style ('' when it needs none), for export. */
export function cssFeatureSettings(st) {
  if (!needsShaping(st)) return '';
  const out = [];
  if (st.ligatures === false) out.push('"liga" 0');
  if (st.contextual === false) out.push('"clig" 0', '"calt" 0');
  for (const t of featureTags(st)) if (!['rlig', 'liga', 'clig', 'calt'].includes(t)) out.push(`"${t}" 1`);
  return out.join(', ');
}
