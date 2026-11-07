import { fillColorCss } from '../core/fill-color.js';
import { borderCss, fontStack } from '../core/format.js';
import { fontColorCss } from '../core/font-color.js';
import { slicerGradientBackground } from '../core/slicer-paint.js';

/** Hover formatting is differential: absent properties retain the item's base paint. */
export function slicerStatePaint(paints, { selected, available, hovered = false }) {
  const state = `${selected ? 'selected' : 'unselected'}ItemWith${available ? 'Data' : 'NoData'}`;
  const base = paints?.items?.[state] || {};
  const hover = hovered ? paints?.items?.[`hovered${state[0].toUpperCase()}${state.slice(1)}`] || {} : {};
  const result = { ...base, ...hover };
  // A replacement solid fill clears an inherited gradient and vice versa.
  if (Object.hasOwn(hover, 'bg')) delete result.gradient;
  if (hover.gradient) delete result.bg;
  return result;
}

/** Apply a resolved state from scratch so leaving hover cannot retain stale CSS. */
export function applySlicerPaint(node, paint, width, height) {
  const st = node.style;
  st.backgroundColor = fillColorCss(paint.bg) || '';
  st.backgroundImage = paint.gradient ? slicerGradientBackground(paint.gradient, width, height) : '';
  st.backgroundSize = paint.gradient ? '100% 100%' : '';
  st.color = fontColorCss(paint.color) || '';
  st.fontFamily = paint.font ? fontStack(paint.font) : '';
  st.fontSize = paint.size != null ? `${paint.size}pt` : '';
  st.fontWeight = paint.bold == null ? '' : paint.bold ? '700' : '400';
  st.fontStyle = paint.italic == null ? '' : paint.italic ? 'italic' : 'normal';
  const underline = paint.underline && paint.underline !== 'none';
  st.textDecorationLine = [underline ? 'underline' : '', paint.strike ? 'line-through' : ''].filter(Boolean).join(' ') || (paint.underline != null || paint.strike != null ? 'none' : '');
  st.textDecorationStyle = underline && paint.underline.startsWith('double') ? 'double' : '';
  for (const [side, key] of [['Left', 'bl'], ['Right', 'br'], ['Top', 'bt'], ['Bottom', 'bb']]) {
    if (paint[key] == null) st[`border${side}`] = '';
    else if (!paint[key]) st[`border${side}`] = 'none';
    else {
      const border = borderCss(paint[`${key}Border`] || paint);
      st[`border${side}`] = `${border.width} ${border.style} ${border.color || 'currentColor'}`;
    }
  }
}
