/** Shared format mappings for the binary and XML Hanword readers. */
// Formats beyond the DOCX names (circled letters and syllables, the ten heavenly stems) are
// written as number text, so they keep their own names here (see numbering.js).
export const numberFormats = ['decimal', 'decimalEnclosedCircle', 'upperRoman', 'lowerRoman', 'upperLetter', 'lowerLetter', 'circledUpperLetter', 'circledLowerLetter', 'ganada', 'circledGanada', 'chosung', 'circledChosung', 'koreanCounting', 'ideographTraditional', 'circledIdeograph', 'heavenlyStems', 'heavenlyStemsHanja'];
export const namedNumberFormats = { DIGIT: 'decimal', CIRCLED_DIGIT: 'decimalEnclosedCircle', ROMAN_CAPITAL: 'upperRoman', ROMAN_SMALL: 'lowerRoman', LATIN_CAPITAL: 'upperLetter', LATIN_SMALL: 'lowerLetter', CIRCLED_LATIN_CAPITAL: 'circledUpperLetter', CIRCLED_LATIN_SMALL: 'circledLowerLetter', HANGUL_SYLLABLE: 'ganada', CIRCLED_HANGUL_SYLLABLE: 'circledGanada', HANGUL_JAMO: 'chosung', CIRCLED_HANGUL_JAMO: 'circledChosung', HANGUL_PHONETIC: 'koreanCounting', IDEOGRAPH: 'ideographTraditional', CIRCLED_IDEOGRAPH: 'circledIdeograph', DECAGON_CIRCLE: 'heavenlyStems', DECAGON_CIRCLE_HANJA: 'heavenlyStemsHanja' };
export const underlineStyles = { SOLID: 'single', DASH: 'dash', DOT: 'dotted', DASH_DOT: 'dotDash', DASH_DOT_DOT: 'dotDotDash', LONG_DASH: 'dashLong', CIRCLE: 'dotted', DOUBLE_SLIM: 'double', SLIM_THICK: 'double', THICK_SLIM: 'double', SLIM_THICK_SLIM: 'double', WAVE: 'wave', DOUBLE_WAVE: 'wavyDouble', THICK_3D: 'thick', THICK_3D_REV: 'thick', SOLID_3D: 'single', SOLID_3D_REV: 'single' };
export const binaryUnderlines = ['single', 'dash', 'dotted', 'dotDash', 'dotDotDash', 'dashLong', 'dotted', 'double', 'double', 'double', 'double', 'wave', 'wavyDouble', 'thick', 'thick', 'single', 'single'];
/** Border line styles as ST_Border values. ST_Border has no long-dash or circle-dot line; the nearest pattern stands in. */
export const borderStyles = { NONE: 'nil', SOLID: 'single', DASH: 'dashed', DOT: 'dotted', DASH_DOT: 'dotDash', DASH_DOT_DOT: 'dotDotDash', LONG_DASH: 'dashed', CIRCLE: 'dotted', DOUBLE_SLIM: 'double', SLIM_THICK: 'thinThickSmallGap', THICK_SLIM: 'thickThinSmallGap', SLIM_THICK_SLIM: 'thinThickThinSmallGap', WAVE: 'wave', DOUBLE_WAVE: 'doubleWave', THICK_3D: 'threeDEmboss', THICK_3D_REV: 'threeDEngrave', SOLID_3D: 'inset', SOLID_3D_REV: 'outset' };
export const binaryBorderStyles = ['NONE', 'SOLID', 'DASH', 'DOT', 'DASH_DOT', 'DASH_DOT_DOT', 'LONG_DASH', 'CIRCLE', 'DOUBLE_SLIM', 'SLIM_THICK', 'THICK_SLIM', 'SLIM_THICK_SLIM', 'WAVE', 'DOUBLE_WAVE', 'THICK_3D', 'THICK_3D_REV', 'SOLID_3D', 'SOLID_3D_REV'].map((name) => borderStyles[name]);
// Hanword's legacy tab positions (binary TAB_DEF, secd default tab, and the
// HWPX default switch branch) are stored in half HWPUNITs: a 40 pt default
// tab is recorded as 8000 while its HWPUNIT form is 4000.
export const legacyTabUnits = (value) => value / 2;
/** The named DOCX highlight colors (ST_HighlightColor); any other highlighter color becomes run shading. */
export const highlightNames = { '000000': 'black', '0000FF': 'blue', '00FFFF': 'cyan', '00FF00': 'green', 'FF00FF': 'magenta', 'FF0000': 'red', 'FFFF00': 'yellow', 'FFFFFF': 'white', '000080': 'darkBlue', '008080': 'darkCyan', '008000': 'darkGreen', '800080': 'darkMagenta', '800000': 'darkRed', '808000': 'darkYellow', '808080': 'darkGray', 'C0C0C0': 'lightGray' };
/** Hanword emphasis marks as w:em values; ST_Em has dots, circles and under-dots, so the other accents become dots. */
export const emphasisMark = (name) => { const key = String(name || 'NONE').toUpperCase(); return key === 'NONE' ? null : key === 'RING_ABOVE' ? 'circle' : key === 'DOT_BELOW' ? 'underDot' : 'dot'; };
export const binaryEmphasis = (index) => index === 0 ? null : index === 2 ? 'circle' : 'dot';
/** The guide text of an empty Hanword click-here field, from its field command. */
export function clickHereGuide(command) {
  const match = /Direction:wstring:(\d+):/.exec(String(command || ''));
  if (!match) return '';
  const length = Math.min(1000, Number(match[1]));
  return [...String(command).slice(match.index + match[0].length)].slice(0, length).join('').trim();
}
/** Whether imported blocks show anything: visible text or an object, not just an empty paragraph. */
export function hasContent(blocks, depth = 0) {
  if (depth > 64) return true;
  return (blocks || []).some((b) => b.kind !== 'p' || (b.runs || []).some((r) => r.kind === 'text' ? r.text.trim() : ['image', 'shape', 'group', 'table', 'equation', 'note', 'ruby', 'field'].includes(r.kind) || (r.kind === 'blocks' && hasContent(r.blocks, depth + 1))));
}
/** After a paragraph's runs are read: an empty click-here field shows its guide text in Hanword, dimmed. */
export function showFieldGuides(runs) {
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i], next = runs[i + 1];
    if (run.kind === 'fieldStart' && run.placeholder && next?.kind === 'fieldEnd' && (run.id === undefined || next.id === run.id)) {
      runs.splice(i + 1, 0, { kind: 'text', text: run.placeholder, char: run.char, props: { color: '808080' } });
    }
  }
  return runs;
}
export const tabLeader = (type) => ({ NONE: 'none', SOLID: 'underscore', DASH: 'hyphen', LONG_DASH: 'hyphen', DOUBLE_SLIM: 'underscore' })[type] || 'dot';

/** Hanword escapes URL colons and separates field options with semicolons. */
export function hyperlinkTarget(command) {
  const target = String(command || '').split(';')[0].replace(/\\:/g, ':').trim();
  if (/^(https?:|mailto:)/i.test(target) && !/[\x00-\x20]/.test(target)) return { href: target };
  // Internal targets occur as #name and ?name. A bare name is accepted only
  // when it resolves to an actual bookmark during DOCX generation.
  if (target && !/^[a-z][\w+.-]*:/i.test(target) && !/[\/\\]/.test(target)) return { anchor: target.replace(/^[#?]/, '') };
  return {};
}

export const pagePositions = ['NONE', 'TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT', 'OUTSIDE_TOP', 'OUTSIDE_BOTTOM', 'INSIDE_TOP', 'INSIDE_BOTTOM'];
export const textDirection = (value) => ({ VERTICAL: 'tbRl', VERTICALALL: 'tbRlV', VERTICAL_ALL: 'tbRlV' })[value];

// Hanword also writes these legacy Wingdings glyphs with ordinary text fonts.
// Keep unrelated private-use text intact (it can contain custom Korean glyphs).
const legacySymbols = { '\uf0ef': '⇦', '\uf0f0': '⇨', '\uf0f1': '⇧', '\uf0f2': '⇩', '\uf06c': '●', '\uf06e': '■', '\uf06f': '☐', '\uf09f': '•', '\uf0a1': '○', '\uf0a7': '▪', '\uf0fc': '✓', '\uf0fe': '☑' };
export function hanwordSymbolText(text) {
  return String(text).replace(/[\uf000-\uf0ff]/g, (c) => {
    if (!legacySymbols[c]) return c;
    return legacySymbols[c];
  });
}
