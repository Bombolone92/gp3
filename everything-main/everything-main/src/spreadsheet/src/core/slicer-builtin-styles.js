/** The built-in slicer styles, which a workbook names without defining.
 *
 * The definitions are written as differential formats, the form a custom style
 * takes, so they decode, follow the workbook theme and export exactly as a
 * custom style would. In the item states a Light style marks the
 * selection with a pale accent, a Dark one with the full accent and white bold
 * text, and every style hovers with the same yellow gradient. The Light frame and
 * the two Other styles (neutral counterparts of Light and Dark) are approximations.
 */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const color = (tag, c) => `<${tag} ${typeof c === 'string' ? `rgb="FF${c}"` : `theme="${c.theme}"${c.tint ? ` tint="${c.tint}"` : ''}`}/>`;
const font = ({ bold, text }) => `<font>${bold ? '<b/>' : ''}${color('color', text)}</font>`;
const solid = bg => `<fill><patternFill patternType="solid">${color('fgColor', bg)}${color('bgColor', bg)}</patternFill></fill>`;
const box = c => `<border>${['left', 'right', 'top', 'bottom'].map(side => `<${side} style="thin">${color('color', c)}</${side}>`).join('')}<vertical/><horizontal/></border>`;
const dxf = body => `<dxf xmlns="${MAIN}">${body}</dxf>`;
const item = ({ text, bold = false, bg, edge }) => dxf(font({ bold, text }) + solid(bg) + box(edge));
const hover = dxf(font({ text: '000000' })
  + '<fill><gradientFill degree="90"><stop position="0"><color rgb="FFF8E162"/></stop><stop position="1"><color rgb="FFFCF7E0"/></stop></gradientFill></fill>'
  + box('999999'));

const TEXT = { theme: 1 }, WHITE = { theme: 0 }, GRAY = { theme: 0, tint: -0.15 };
const tint = (c, value) => ({ ...c, tint: value });

/** A pale selection on white items. */
function light(accent) {
  return {
    frame: {
      wholeTable: dxf(font({ text: TEXT }) + box(GRAY)),
      headerRow: dxf(font({ bold: true, text: TEXT }) + `<border><bottom style="thin">${color('color', accent)}</bottom><vertical/><horizontal/></border>`),
    },
    items: {
      unselectedItemWithData: item({ text: '000000', bg: 'FFFFFF', edge: 'CCCCCC' }),
      unselectedItemWithNoData: item({ text: '828282', bg: 'FFFFFF', edge: 'E0E0E0' }),
      selectedItemWithData: item({ text: '000000', bg: tint(accent, 0.6), edge: '999999' }),
      selectedItemWithNoData: item({ text: '828282', bg: tint(accent, 0.8), edge: 'CCCCCC' }),
    },
  };
}

/** A full-accent selection on gray items, in an accent frame. */
function dark(accent) {
  return {
    frame: {
      wholeTable: dxf(font({ text: TEXT }) + box(accent)),
      headerRow: dxf(font({ bold: true, text: TEXT }) + `<border><bottom style="thin">${color('color', accent)}</bottom><vertical/><horizontal/></border>`),
    },
    items: {
      unselectedItemWithData: item({ text: '000000', bg: GRAY, edge: 'C0C0C0' }),
      unselectedItemWithNoData: item({ text: '959595', bg: 'DFDFDF', edge: 'DFDFDF' }),
      selectedItemWithData: item({ text: WHITE, bold: true, bg: accent, edge: accent }),
      selectedItemWithNoData: item({ text: tint(accent, -0.25), bg: tint(accent, 0.6), edge: tint(accent, 0.6) }),
    },
  };
}

const withHover = style => ({
  ...style,
  items: { ...style.items, hoveredUnselectedItemWithData: hover, hoveredSelectedItemWithData: hover, hoveredUnselectedItemWithNoData: hover, hoveredSelectedItemWithNoData: hover },
});

// Theme color 4 is Accent 1; Light1 and Dark1 use it, Light6 and Dark6 use Accent 6.
const STYLES = new Map([
  ...[1, 2, 3, 4, 5, 6].flatMap(n => [
    [`SlicerStyleLight${n}`, withHover(light({ theme: n + 3 }))],
    [`SlicerStyleDark${n}`, withHover(dark({ theme: n + 3 }))],
  ]),
  ['SlicerStyleOther1', withHover(light(tint(TEXT, 0.5)))],
  ['SlicerStyleOther2', withHover(dark(tint(TEXT, 0.35)))],
]);

/** The DXF XML of a built-in style's frame and item parts, or null for a name that is not a built-in style. */
export function builtInSlicerStyle(name) {
  return STYLES.get(name) || null;
}

/** The style used when a workbook names none. */
export const DEFAULT_SLICER_STYLE = 'SlicerStyleLight1';
