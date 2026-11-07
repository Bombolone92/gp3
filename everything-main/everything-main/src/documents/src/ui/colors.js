/**
 * Color palettes and the swatch popover used for text color and highlight.
 * Colors are plain hex so they round-trip into DOCX unchanged; the first row
 * is grayscale, the rest are theme colors and highlighter tones.
 */

import { el } from './dom.js';
import { closeMenu, openMenu } from './menu.js';

export const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#efefef', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff',
  '#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3',
  '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc', '#cc4125', '#e06666', '#f6b26b', '#ffd966',
  '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0', '#a61c00', '#cc0000',
  '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394',
  '#351c75', '#741b47', '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d',
];

export const HIGHLIGHT_COLORS = [
  '#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#0000ff', '#ff0000', '#000080', '#008080',
  '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0', '#fff2cc', '#d9ead3',
];

/* Every swatch has a spoken name: the text palette is a row of grays, a row of hues, then the
   same ten hues from pale to darkest; the highlight palette uses the OOXML highlight names. */
const HUES = ['red berry', 'red', 'orange', 'yellow', 'green', 'cyan', 'cornflower blue', 'blue', 'purple', 'magenta'];
const HUE_TIERS = [
  ['Pale', ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc']],
  ['Light', ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0']],
  ['Dark', ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79']],
  ['Darker', ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47']],
  ['Darkest', ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d']],
];
export const COLOR_NAMES = {
  '#000000': 'Black', '#434343': 'Darkest gray', '#666666': 'Dark gray', '#999999': 'Gray',
  '#b7b7b7': 'Light gray', '#cccccc': 'Lighter gray', '#efefef': 'Lightest gray', '#ffffff': 'White',
  '#980000': 'Red berry', '#ff0000': 'Red', '#ff9900': 'Orange', '#ffff00': 'Yellow', '#00ff00': 'Green',
  '#00ffff': 'Cyan', '#4a86e8': 'Cornflower blue', '#0000ff': 'Blue', '#9900ff': 'Purple', '#ff00ff': 'Magenta',
  ...Object.fromEntries(HUE_TIERS.flatMap(([tier, hexes]) => hexes.map((hex, i) => [hex, `${tier} ${HUES[i]}`]))),
  '#000080': 'Navy', '#008080': 'Teal', '#008000': 'Dark green', '#800080': 'Dark purple', '#800000': 'Dark red',
  '#808000': 'Olive', '#808080': 'Medium gray', '#c0c0c0': 'Silver',
};

/** The named highlight colors of ST_HighlightColor, as DOCX files carry them. */
const NAMED_HIGHLIGHTS = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkblue: '#000080', darkcyan: '#008080', darkgreen: '#008000', darkmagenta: '#800080', darkred: '#800000',
  darkyellow: '#808000', darkgray: '#808080', lightgray: '#c0c0c0', black: '#000000', white: '#ffffff',
};

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (Object.hasOwn(NAMED_HIGHLIGHTS, v)) return NAMED_HIGHLIGHTS[v];
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const rgb = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*(1(?:\.0+)?))?\s*\)$/.exec(v);
  if (rgb && rgb.slice(1, 4).every((n) => Number(n) <= 255)) {
    return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

/**
 * openColorMenu({ anchor, colors, current, onPick, label, noneLabel })
 * `onPick(hex)` receives '#rrggbb', or null for "none / automatic".
 */
export function openColorMenu({ anchor, x = null, y = null, colors, current = null, onPick, label = 'Color', noneLabel = 'Automatic', focusFirst = true }) {
  const cur = normalizeHex(current);
  // A pick is the end of the matter: it closes every menu on the way here, not only this one.
  const close = () => closeMenu();
  const swatch = (hex) => el('button.swatch', {
    type: 'button', tabindex: -1,
    style: { background: hex },
    'aria-label': COLOR_NAMES[hex] || hex,
    'aria-pressed': String(cur === hex),
    title: COLOR_NAMES[hex] || hex,
    onclick: () => { if (grid.isConnected) { close(); onPick(hex); } },
  });
  const grid = el('div.menu-custom-grid', { role: 'group', 'aria-label': label, dataset: { columns: '8' } }, colors.map(swatch));
  const none = el('button.menu-item', {
    type: 'button', role: 'menuitem', tabindex: -1,
    onclick: () => { if (none.isConnected) { close(); onPick(null); } },
  }, el('span.swatch.swatch-none', { 'aria-hidden': 'true', style: { width: '18px', height: '18px', borderRadius: '5px' } }), el('span.menu-label', {}, noneLabel));
  // Native pickers may emit change for every adjustment and move focus to a
  // separate window. Keep a draft until Apply so the picker is not detached
  // halfway through a choice, and Escape never applies a late change event.
  const hexInput = el('input.input.color-hex', {
    type: 'text', value: cur || '#000000', 'aria-label': `Custom ${label.toLowerCase()} hex value`,
    spellcheck: false, autocomplete: 'off', maxlength: 7,
    oninput: () => {
      const hex = normalizeHex(hexInput.value);
      hexInput.setCustomValidity(hex ? '' : 'Enter a hex color, such as #123456');
      if (hex) colorInput.value = hex;
    },
  });
  const updateDraft = () => { hexInput.value = colorInput.value; hexInput.setCustomValidity(''); };
  const colorInput = el('input.color-input', {
    type: 'color', value: cur || '#000000', 'aria-label': `Custom ${label.toLowerCase()}`,
    oninput: updateDraft, onchange: updateDraft,
  });
  const custom = el('form.menu-custom-color', {
    'aria-label': `Custom ${label.toLowerCase()}`,
    onsubmit: (e) => {
      e.preventDefault();
      const hex = normalizeHex(hexInput.value);
      if (!hex || !custom.isConnected) return;
      close();
      onPick(hex);
    },
  }, el('span.menu-label', {}, 'Custom'), colorInput, hexInput, el('button.btn.btn-outline.btn-sm', { type: 'submit' }, 'Apply'));
  return openMenu({ anchor, x, y, label, items: [{ custom: grid }, { separator: true }, { custom: none }, { custom }], minWidth: 288, closeOnWindowBlur: false, focusFirst });
}
