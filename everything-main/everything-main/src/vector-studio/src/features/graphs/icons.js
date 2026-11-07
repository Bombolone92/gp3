/** Original 24x24 stroke icons for the graph tools and the Graph Data window. */
import { registerIcons } from '../../ui/icons.js';

const P = (d, extra = {}) => ['path', { d, ...extra }];
const R = (x, y, w, hh, extra = {}) => ['rect', { x: String(x), y: String(y), width: String(w), height: String(hh), ...extra }];
const C = (cx, cy, r, extra = {}) => ['circle', { cx: String(cx), cy: String(cy), r: String(r), ...extra }];
const AXES = P('M3 3v18h18');

export function registerGraphIcons() {
  registerIcons({
    'tool-graph-column': [AXES, R(6, 11, 3, 10), R(10.5, 6, 3, 15), R(15, 13, 3, 8)],
    'tool-graph-stacked-column': [AXES, R(6, 11, 4, 10), P('M6 15h4'), R(13, 5, 4, 16), P('M13 12h4')],
    'tool-graph-bar': [AXES, R(3, 5, 10, 3), R(3, 10.5, 16, 3), R(3, 16, 7, 3)],
    'tool-graph-stacked-bar': [AXES, R(3, 6, 11, 4), P('M8 6v4'), R(3, 13, 17, 4), P('M11 13v4')],
    'tool-graph-line': [AXES, P('m6 16 4-6 4 3 6-7', { 'stroke-linejoin': 'round' }), R(5, 15, 2, 2, { fill: 'currentColor' }), R(9, 9, 2, 2, { fill: 'currentColor' }), R(13, 12, 2, 2, { fill: 'currentColor' })],
    'tool-graph-area': [AXES, P('M3 21v-6l5-5 5 3 8-7v15z', { fill: 'currentColor', 'fill-opacity': '0.25', 'stroke-linejoin': 'round' })],
    'tool-graph-scatter': [AXES, C(7.5, 15, 1.4, { fill: 'currentColor' }), C(11, 10, 1.4, { fill: 'currentColor' }), C(15, 13, 1.4, { fill: 'currentColor' }), C(18, 6.5, 1.4, { fill: 'currentColor' })],
    'tool-graph-pie': [C(12, 12, 9), P('M12 12V3M12 12l7.4 5.1M12 12l-6.6 6.1')],
    'tool-graph-radar': [P('M12 2.5 21 9l-3.4 10.5H6.4L3 9z', { 'stroke-linejoin': 'round' }), P('m12 7 4.5 3.4-1.8 5.6H9.3l-1.8-5.6z', { 'stroke-linejoin': 'round', fill: 'currentColor', 'fill-opacity': '0.3' })],
    'gd-import': [P('M12 3v12'), P('m7 10 5 5 5-5'), P('M4 17v3h16v-3')],
    'gd-transpose': [R(3, 3, 7, 7), R(14, 14, 7, 7), P('M14 6h4a2 2 0 0 1 2 2v3'), P('m17.5 8.5 2.5 2.5 2.5-2.5'), P('M10 18H6a2 2 0 0 1-2-2v-3'), P('M6.5 15.5 4 13l-2.5 2.5')],
    'gd-switch-xy': [P('M9 8h11'), P('m17 5 3 3-3 3'), P('M15 16H4'), P('m7 13-3 3 3 3'), P('m2.5 3.5 4 4M6.5 3.5l-4 4'), P('m17.5 16.5 2 2.5 2-2.5M19.5 19v3')],
    'gd-revert': [P('M3 12a9 9 0 1 0 3-6.7'), P('M3 3v5h5')],
  });
}
