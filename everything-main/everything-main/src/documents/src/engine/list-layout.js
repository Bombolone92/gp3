import { underlineDeclaration, markerUnderlines } from './underlines.js';
import { checkedCapitalization, resolveCapitalization } from './capitalization.js';
import { checkedStrike, resolveStrike } from './strikethrough.js';
import { inlineSegments } from './images.js';
import { checkSpacedAdvance } from './character-spacing.js';
import { LineBuilder } from './line-builder.js';

/** The label and suffix occupy space without adding editable source characters. */
export function markerGeometry(marker, markFormat, left, right, format, page, measure, offset) {
  if (!marker) return { left, marker: null };
  const legacy = marker.level.legacy;
  const legacyIndent = legacy ? (legacy.indent ?? -format.firstLine) / 15 : 0;
  if (legacy && legacyIndent < 0) {
    // A negative legacy indent suppresses the label and moves the
    // first text line by that signed distance. Continuations retain normal indents.
    const textLeft = left + legacyIndent;
    if (!page.allowOverflowIndents && textLeft < 0 || textLeft >= right) throw new Error('The legacy list indent leaves no writing space.');
    return { left: textLeft, marker: null };
  }
  if (marker.level.markerStyle.strikethrough !== undefined) checkedStrike(marker.level.markerStyle.strikethrough, true);
  if (marker.level.markerStyle.capitalization !== undefined) checkedCapitalization(marker.level.markerStyle.capitalization, true);
  const style = { ...markFormat, ...underlineDeclaration(marker.level.markerStyle), ...(marker.level.symbol ? { symbol: marker.level.symbol } : {}), capitalization: resolveCapitalization(markFormat.capitalization, marker.level.markerStyle.capitalization), strikethrough: resolveStrike(markFormat.strikethrough, marker.level.markerStyle.strikethrough) }, measured = measure(marker.text, style);
  if (style.characterSpacing < 0) {
    let prefix = '', previous = 0;
    for (const part of inlineSegments(marker.text)) { prefix += part.segment; const width = measure(prefix, style).width; checkSpacedAdvance(width, previous, style); previous = width; }
  }
  const legacyTextLeft = legacy ? left + Math.max(legacyIndent, measured.width + legacy.space / 15) : null;
  const x = legacy ? marker.level.alignment === 'right' ? legacyTextLeft - legacy.space / 15 - measured.width
    : marker.level.alignment === 'center' ? left + Math.max(0, (legacyIndent - measured.width) / 2) : left
    : left - measured.width * (marker.level.alignment === 'right' ? 1 : marker.level.alignment === 'center' ? 0.5 : 0);
  if (x < 0 && !page.allowOverflowIndents) throw new Error('The list label extends outside the page. Increase the paragraph indent.');
  const label = { ...style, ...measured, text: marker.text, x, underlines: markerUnderlines(marker.text, style, measured, measure) };
  if (legacy) {
    if (legacyTextLeft >= right) throw new Error('The list label leaves no writing space. Reduce its size or adjust the indents.');
    return { left: legacyTextLeft, marker: label };
  }
  let textLeft = x + measured.width;
  if (marker.level.suffix === 'space') textLeft += measure(' ', style).width;
  // The body indent itself is accepted as the numbering suffix destination
  // when the label already ends there, including a zero hanging indent.
  const atBodyIndent = Math.abs(textLeft - page.left - format.indentLeft / 15) < 1e-6;
  // An invalid deeper-level label uses the fallback 18pt numbering tab,
  // accepting equality at that stop just as at the paragraph's body indent.
  const atFallbackTab = marker.suppressed && Math.abs(textLeft - page.left - 24) < 1e-6;
  if (marker.level.suffix === 'tab' && !atBodyIndent && !atFallbackTab) {
    const builder = new LineBuilder(textLeft, right, format, { ...page, numberingSuffix: true }, measure, offset);
    builder.add({ text: '\t', start: offset, end: offset, style });
    textLeft = builder.end;
    label.tabSuffix = builder.finish();
  }
  if (textLeft >= right) throw new Error('The list label leaves no writing space. Reduce its size or adjust the indents.');
  return { left: textLeft, marker: label };
}
