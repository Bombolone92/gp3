export const TAB_LEADERS = Object.freeze({ none: 'None', dot: 'Dots', hyphen: 'Dashes', underscore: 'Line', heavy: 'Heavy (legacy)', middleDot: 'Middle dots' });
const characters = { dot: '.', hyphen: '-', underscore: '_', heavy: '_', middleDot: '·' };

// Leader glyphs sit on a page-relative 600 dpi advance grid. This is
// ink geometry only: tab fields, source positions and stored run properties
// retain their original measurements (see the independent native references).
const quantum = 96 / 600;
const snap = value => Math.round(value / quantum) * quantum;

/** Generated ink fits within the resolved tab gap; it never adds source positions. */
export function tabLeader(tab, x, width, measure) {
  const text = characters[tab.leader];
  if (!text || width <= 0) return null;
  const style = { ...tab.style, fontSize: snap((tab.style.fontSize ?? 12) * 4 / 3) * .75, justificationSpacing: 0 };
  const unspaced = { ...style, characterSpacing: 0 };
  const single = measure(text, unspaced), pair = measure(text + text, unspaced);
  const glyphAdvance = pair.width - single.width;
  const spacing = (style.characterSpacing || 0) * 4 / 3;
  const nativeAdvance = glyphAdvance + spacing;
  if (!(nativeAdvance > 0)) throw new Error('This character spacing leaves no room for tab leaders. Increase the spacing.');
  // Keep the density guard before rounding so tiny positive advances cannot
  // become a zero divisor or silently remove the previous validation limit.
  if (width / nativeAdvance > 20000) throw new Error('These tab leaders are too dense. Increase the font size or text width.');
  const advance = snap(glyphAdvance) + snap(spacing);
  if (!(advance > 0)) return null;
  // Compare coordinates on the same grid as the advance. Native fractional
  // text widths just beyond a grid boundary must not skip a whole glyph.
  const start = Math.ceil((snap(x) - 1e-7) / advance) * advance;
  const count = Math.floor((x + width - start + 1e-7) / advance);
  if (count < 1) return null;
  if (count > 20000) throw new Error('These tab leaders are too dense. Increase the font size or text width.');
  style.characterSpacing = (advance - glyphAdvance) * .75;
  const repeated = text.repeat(count), metrics = measure(repeated, style);
  const scale = metrics.textTransform?.scaleX || 1;
  const offset = (start - x) / scale;
  // Capitalization/font segments are painted at their own local origins.
  if (metrics.textParts) metrics.textParts = metrics.textParts.map(part => ({ ...part, x: part.x + offset }));
  return { ...style, ...metrics, text: repeated, x, width,
    textOffsetX: (metrics.textOffsetX || 0) + offset, leader: tab.leader };
}
