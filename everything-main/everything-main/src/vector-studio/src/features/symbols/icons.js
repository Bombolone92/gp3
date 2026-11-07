/** Original glyphs for symbols, drawn on the 24px icon grid (2px strokes, currentColor). */
import { registerIcons } from '../../ui/icons.js';

// A small diamond: the mark used for "symbol" throughout.
const gem = (cx, cy, r, filled = false) => ['path', { d: `M${cx} ${cy - r}l${r} ${r}-${r} ${r}-${r}-${r}z`, ...(filled ? { fill: 'currentColor' } : {}) }];

export function registerSymbolIcons() {
  registerIcons({
    symbol: [['rect', { x: '3', y: '3', width: '18', height: '18', rx: '4' }], gem(12, 12, 5, true)],
    'symbol-place': [['path', { d: 'M2 12h9M8 8.5 11.5 12 8 15.5' }], gem(17.5, 12, 4.5)],
    'symbol-break': [['path', { d: 'M10 5 4 12l6 7' }], ['path', { d: 'M14 5l6 7-6 7' }], ['path', { d: 'M13.5 3.5l-3 17' }]],
    'symbol-new': [gem(10, 12, 7), ['path', { d: 'M18 3v6M15 6h6' }]],
    'symbol-library': [['path', { d: 'M4 4h4v16H4zM10 4h4v16h-4z' }], ['path', { d: 'm16.4 4.6 3.9 1-3.6 14.8-3.9-1z' }]],
    'symbols-grid': [['rect', { x: '4', y: '4', width: '6.5', height: '6.5', rx: '1' }], ['rect', { x: '13.5', y: '4', width: '6.5', height: '6.5', rx: '1' }], ['rect', { x: '4', y: '13.5', width: '6.5', height: '6.5', rx: '1' }], ['rect', { x: '13.5', y: '13.5', width: '6.5', height: '6.5', rx: '1' }]],
    'symbols-list-small': [['rect', { x: '3', y: '4.5', width: '3', height: '3' }], ['rect', { x: '3', y: '10.5', width: '3', height: '3' }], ['rect', { x: '3', y: '16.5', width: '3', height: '3' }], ['path', { d: 'M9 6h12M9 12h12M9 18h12' }]],
    'symbols-list-large': [['rect', { x: '3', y: '3.5', width: '7', height: '7', rx: '1' }], ['rect', { x: '3', y: '13.5', width: '7', height: '7', rx: '1' }], ['path', { d: 'M13 7h8M13 17h8' }]],
    'tool-symbol-shifter': [gem(8, 12, 5), ['path', { d: 'M14 12h8M19 9l3 3-3 3' }]],
    'tool-symbol-scruncher': [gem(6, 7, 3.5), gem(18, 7, 3.5), gem(12, 17, 3.5), ['path', { d: 'M9 10l1.5 1.5M15 10l-1.5 1.5' }]],
    'tool-symbol-sizer': [gem(7, 16, 3.5), gem(15, 9, 6.5), ['path', { d: 'M20 21l1.5-1.5M21.5 19.5V22h-2.5' }]],
    'tool-symbol-spinner': [gem(12, 12, 4.5), ['path', { d: 'M4 12a8 8 0 0 1 13.7-5.6M20 4v4h-4' }], ['path', { d: 'M20 12a8 8 0 0 1-13.7 5.6' }]],
    'tool-symbol-stainer': [gem(9, 13, 6), ['path', { d: 'M19 3.5c1.6 2.2 2.5 3.6 2.5 4.8a2.5 2.5 0 0 1-5 0c0-1.2.9-2.6 2.5-4.8z', fill: 'currentColor' }]],
    'tool-symbol-screener': [gem(12, 12, 8), ['path', { d: 'M12 6v12M14.5 8.5v7M17 11v2', 'stroke-width': '1.5' }]],
    'tool-symbol-styler': [gem(9, 14, 6), ['path', { d: 'M17 3l1.2 2.8L21 7l-2.8 1.2L17 11l-1.2-2.8L13 7l2.8-1.2z' }]],
  });
}
