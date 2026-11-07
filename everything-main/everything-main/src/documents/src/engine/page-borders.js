import { checkedParagraphBorder, borderWidth } from './paragraph-borders.js';

export const PAGE_BORDER_SIDES = ['top', 'left', 'bottom', 'right'];
function checkedPageBorder(border) {
  const size = border?.size ?? 0;
  if (!Number.isSafeInteger(size) || size < 0 || size > 65535) throw new Error('Invalid page border width.');
  return { ...checkedParagraphBorder({ ...border, size: 2 }), size };
}
export function pageBorderWidth(border) {
  if (!border || ['none', 'nil'].includes(border.style)) return 0;
  // Native page borders retain large sizes and quantize ordinary lines to
  // 600dpi, with a one-unit hairline for omitted/zero sizes.
  if (['single','double','triple','dotted','dashed','dashSmallGap','dotDash','dotDotDash'].includes(border.style)) return Math.max(1, Math.floor(border.size * 25 / 24)) * .16;
  return borderWidth(border);
}
export function checkedPageBorders(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['offsetFrom', 'display', 'zOrder', 'borders'].includes(k))) throw new Error('Invalid page borders.');
  const { offsetFrom = 'text', display = 'allPages', zOrder = 'front', borders = {} } = value;
  if (!['page', 'text'].includes(offsetFrom) || !['allPages', 'firstPage', 'notFirstPage'].includes(display) || !['front', 'back'].includes(zOrder)) throw new Error('Invalid page border positioning.');
  if (!borders || Array.isArray(borders) || typeof borders !== 'object' || Object.keys(borders).some(k => !PAGE_BORDER_SIDES.includes(k))) throw new Error('Invalid page border sides.');
  return { offsetFrom, display, zOrder, borders: Object.fromEntries(Object.entries(borders).map(([side, border]) => [side, checkedPageBorder(border)])) };
}

/** Page borders are decoration; they never consume text or table layout space. */
export function pageBorderStrokes(page, sectionPage = 0) {
  const value = page.pageBorders;
  if (!value || value.display === 'firstPage' && sectionPage !== 0 || value.display === 'notFirstPage' && sectionPage === 0) return [];
  const borders = value.borders, outer = {}, inner = {};
  for (const side of PAGE_BORDER_SIDES) {
    const width = pageBorderWidth(borders[side]), space = (borders[side]?.space || 0) * 4 / 3;
    const leading = side === 'left' || side === 'top', extent = ['top', 'bottom'].includes(side) ? page.height : page.width;
    if (value.offsetFrom === 'page') {
      outer[side] = leading ? space : extent - space;
      inner[side] = outer[side] + (leading ? width : -width);
    } else {
      inner[side] = leading ? page[side] - space : extent - page[side] + space;
      outer[side] = inner[side] + (leading ? -width : width);
    }
  }
  const strokes = [];
  const add = (side, x, y, width, height, horizontal, clip) => {
    if (pageBorderWidth(borders[side]) && width > 0 && height > 0) strokes.push({side, x, y, width, height, horizontal, clip, border: borders[side], background: page.background || '#FFFFFF'});
  };
  add('top', outer.left, outer.top, outer.right - outer.left, inner.top - outer.top, true,
    [[outer.left,outer.top],[outer.right,outer.top],[inner.right,inner.top],[inner.left,inner.top]]);
  add('bottom', outer.left, inner.bottom, outer.right - outer.left, outer.bottom - inner.bottom, true,
    [[inner.left,inner.bottom],[inner.right,inner.bottom],[outer.right,outer.bottom],[outer.left,outer.bottom]]);
  add('left', outer.left, outer.top, inner.left - outer.left, outer.bottom - outer.top, false,
    [[outer.left,outer.top],[inner.left,inner.top],[inner.left,inner.bottom],[outer.left,outer.bottom]]);
  add('right', inner.right, outer.top, outer.right - inner.right, outer.bottom - outer.top, false,
    [[inner.right,inner.top],[outer.right,outer.top],[outer.right,outer.bottom],[inner.right,inner.bottom]]);
  // Adjacent triangles antialias independently and leave a pale diagonal seam.
  // A solid, equally colored frame is a union of four disjoint rectangles.
  if (strokes.every(s => s.border.style === 'single' && s.border.color === strokes[0].border.color)) {
    for (const stroke of strokes) {
      delete stroke.clip;
      if (!stroke.horizontal) { stroke.y = inner.top; stroke.height = Math.max(0, inner.bottom - inner.top); }
    }
  }
  return strokes;
}
