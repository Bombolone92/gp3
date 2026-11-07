import { fontStack } from '../core/format.js';
import { fontColorCss } from '../core/font-color.js';
import { el } from './dom.js';

export function richTextNode(text, run, { style = {}, zoom = 1, color = null } = {}) {
  const s = { ...style, ...run };
  const underline = s.underline && s.underline !== 'none';
  const node = el('span.rich-text-run', { style: {
    fontWeight: s.bold ? '600' : '400',
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecorationLine: [underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
    textDecorationStyle: typeof s.underline === 'string' && s.underline.startsWith('double') ? 'double' : 'solid',
    ...(s.font ? { fontFamily: fontStack(s.font) } : {}),
    ...(s.size ? { fontSize: `${s.size * zoom}px` } : {}),
    ...(s.color || color ? { color: fontColorCss(color || s.color) } : {}),
    ...(s.vertAlign ? { verticalAlign: { superscript: 'super', subscript: 'sub', baseline: 'baseline' }[s.vertAlign] } : {}),
  } }, text);
  return node;
}
