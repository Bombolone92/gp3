import { UnsupportedDocumentError } from './errors.js';
import { inlineSegments } from './images.js';
import { kerningEnabled } from './kerning.js';
import {preparedScriptSize} from './script-font-size.js';

const combined = { bothCapsOff: ['capsOff', 'smallCapsOff'], capsSmallCapsOff: ['caps', 'smallCapsOff'], smallCapsCapsOff: ['capsOff', 'smallCaps'], bothCapsOn: ['caps', 'smallCaps'] };
export const capitalizationDeclarations = value => combined[value] || [value];
export function checkedCapitalization(value, declaration = false) {
  if (!(declaration ? ['caps', 'smallCaps', 'capsOff', 'smallCapsOff', ...Object.keys(combined)] : ['normal', 'caps', 'smallCaps']).includes(value)) throw new UnsupportedDocumentError('invalid capitalization value');
  return value;
}

// Each form is a toggle. Keep explicit false distinct from an editor reset,
// since it clears only that form. Competing positive declarations choose the
// later form, as with the engine's mutually exclusive strike declarations.
export function resolveCapitalization(inherited = 'normal', declaration, toggle = false, defaultMode = 'normal') {
  if (declaration === undefined) return inherited;
  if (combined[declaration]) {
    // Resolve simultaneous flags independently, before choosing the display
    // form. Effective caps take precedence over effective small caps.
    const [caps, small] = combined[declaration].map(value => resolveCapitalization(inherited, value, toggle, defaultMode));
    return caps === 'caps' ? 'caps' : small === 'smallCaps' ? 'smallCaps' : 'normal';
  }
  if (declaration === 'normal') return 'normal';
  checkedCapitalization(declaration, true);
  const kind = declaration.startsWith('smallCaps') ? 'smallCaps' : 'caps', enabled = !declaration.endsWith('Off');
  const on = toggle ? (inherited === kind) !== (enabled !== (defaultMode === kind)) : enabled;
  return on ? kind : inherited === kind ? 'normal' : inherited;
}

// Locale-neutral Unicode letter casing; source graphemes and their UTF-16
// offsets remain unchanged. Nonletters (including combining marks) stay intact.
const upper = text => text.replace(/[\p{Ll}\p{Lt}]/gu, letter => letter.toUpperCase());
export function checkCapitalizationText(text = '', style) {
  if (style.characterSpacing && ['caps', 'smallCaps'].includes(style.capitalization) && upper(text).length !== text.length) throw new UnsupportedDocumentError('character spacing with expanding uppercase mappings');
}
// The OOXML kerning threshold compares w:sz. Resolve it before reducing the
// displayed size, then give the native shaper an always-on/off threshold.
export const capitalizationPartStyle = (style, part) => {
  const result = { ...style, ...(part.fontFamily ? { fontFamily: part.fontFamily } : {}), fontSize: part.fontSize, kerning: kerningEnabled(style) ? 1 : 0 };
  if(style.verticalAlign&&style.verticalAlign!=='baseline')result.scriptReferenceSize=style.scriptReferenceSize??style.fontSize??12;
  return result;
};
export function capitalizationParts(text, style,displayedScriptSize) {
  if (!style.capitalization || style.capitalization === 'normal') return null;
  checkCapitalizationText(text, style);
  const fontSize = style.fontSize ?? 12;
  if (style.capitalization === 'caps') return [{ text: upper(text), fontSize }];
  const script=displayedScriptSize??(style.verticalAlign&&style.verticalAlign!=='baseline'?preparedScriptSize(style):null);
  const scale=script===null?null:script/(style.scriptReferenceSize??fontSize);
  // The script is reduced first, then the small-cap display size is rounded.
  // Store the equivalent pre-transform size so the run keeps one baseline.
  const smallSize=script===null?Math.max(1,Math.round(fontSize*1.6)/2):Math.max(1,Math.round(script*1.6)/2)/scale;
  const parts = [];
  for (const { segment } of inlineSegments(text)) {
    // Small capitals are scaled to 80%, rounded to half points (1pt minimum),
    // rather than the fixed two-point reduction described in Part 1 §17.3.2.33.
    // Ordinary spaces have the reduced size regardless of neighboring case.
    // NBSP, other Unicode spaces and punctuation retain the authored size.
    const small = /\p{Ll}/u.test(segment) || segment === ' ';
    const size = small ? smallSize : fontSize;
    const last = parts.at(-1), displayed = upper(segment);
    if (last?.fontSize === size) last.text += displayed;
    else parts.push({ text: displayed, fontSize: size });
  }
  return parts.length ? parts : [{ text: '', fontSize }];
}
