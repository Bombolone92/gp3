/**
 * Original glyphs for repeats, objects on path, paint regions and
 * interlacing: 24px grid, 2px strokes in currentColor (set by icon()).
 */
const C = (cx, cy, r, extra = {}) => ['circle', { cx: String(cx), cy: String(cy), r: String(r), ...extra }];
const P = (d, extra = {}) => ['path', { d, ...extra }];
const R = (x, y, w, hgt, extra = {}) => ['rect', { x: String(x), y: String(y), width: String(w), height: String(hgt), ...extra }];

export const FEATURE_ICONS = {
  'repeat-radial': [C(12, 4.5, 2), C(18.5, 8.25, 2), C(18.5, 15.75, 2), C(12, 19.5, 2), C(5.5, 15.75, 2), C(5.5, 8.25, 2)],
  'repeat-grid': [R(4, 4, 6, 6, { rx: '1' }), R(14, 4, 6, 6, { rx: '1' }), R(4, 14, 6, 6, { rx: '1' }), R(14, 14, 6, 6, { rx: '1' })],
  'repeat-mirror': [P('M12 3v18', { 'stroke-dasharray': '2 2.5' }), P('M9 7 4 17h5z', { 'stroke-linejoin': 'round' }), P('M15 7l5 10h-5z', { 'stroke-linejoin': 'round' })],
  'grid-type-grid': [R(4, 5, 16, 14, { rx: '1' }), P('M4 12h16M9.33 5v14M14.67 5v14')],
  'grid-type-brick-row': [R(4, 5, 16, 14, { rx: '1' }), P('M4 12h16M9.33 5v7M14.67 5v7M6.67 12v7M12 12v7M17.33 12v7')],
  'grid-type-brick-col': [R(4, 5, 16, 14, { rx: '1' }), P('M12 5v14M4 9.67h8M4 14.33h8M12 7.33h8M12 12h8M12 16.67h8')],
  'repeat-instances': [C(5.5, 15, 2), C(12, 8, 2), C(18.5, 15, 2), P('M7 13.3 10.4 9.7M13.6 9.7l3.4 3.6', { 'stroke-dasharray': '1.5 1.5' })],
  'repeat-radius': [C(12, 12, 8, { 'stroke-dasharray': '2.5 2' }), P('M12 12h8'), C(12, 12, 1.5, { fill: 'currentColor' })],
  'repeat-start': [P('M12 20V5'), P('M12 5l-3 3M12 5l3 3'), C(12, 20, 1.5, { fill: 'currentColor' })],
  'repeat-span': [P('M5.1 16A8 8 0 1 1 18.9 16'), C(12, 12, 1.5, { fill: 'currentColor' }), P('M18.9 16l.6-3.2M18.9 16l-3.1-.9')],
  'spacing-h': [P('M4 4v16M20 4v16'), P('M8 12h8M8 12l2.5-2.5M8 12l2.5 2.5M16 12l-2.5-2.5M16 12l-2.5 2.5')],
  'spacing-v': [P('M4 4h16M4 20h16'), P('M12 8v8M12 8 9.5 10.5M12 8l2.5 2.5M12 16l-2.5-2.5M12 16l2.5-2.5')],
  'grid-cols': [R(4, 4, 16, 16, { rx: '1' }), P('M9.33 4v16M14.67 4v16')],
  'grid-rows': [R(4, 4, 16, 16, { rx: '1' }), P('M4 9.33h16M4 14.67h16')],
  'repeat-axis': [P('M7 20 17 4', { 'stroke-dasharray': '2 2' }), P('M4 9l4 1.5L6 14z', { 'stroke-linejoin': 'round' })],
  'objects-on-path': [P('M3 17c4-8 7-8 9-4s5 4 9-4'), C(6, 12, 2), C(12, 13, 2), C(18, 10, 2)],
  'path-offset': [P('M3 17c4-8 7-8 9-4s5 4 9-4', { 'stroke-dasharray': '2 2' }), P('M3 17v-5M3 17h5')],
  'tool-paint-bucket': [P('M4.5 12.5 11 6l7 7-6.5 6.5a1.4 1.4 0 0 1-2 0l-5-5a1.4 1.4 0 0 1 0-2z', { 'stroke-linejoin': 'round' }), P('M11 6 8.5 3.5'), P('M5 13h12.5', { 'stroke-width': '1.5' }), P('M20.5 17.5a1.5 1.5 0 0 1-3 0c0-1.2 1.5-3 1.5-3s1.5 1.8 1.5 3z', { fill: 'currentColor' })],
  'tool-region-select': [R(3, 3, 11, 11, { 'stroke-dasharray': '2 2' }), P('M3 9h5v5', { fill: 'currentColor', 'stroke-width': '0' }), P('M11 11l9 3.5-4 1.5-1.5 4z', { fill: 'currentColor', 'stroke-linejoin': 'round' })],
  'regions-gaps': [P('M4 18V6h7M20 6v12h-7', { 'stroke-linejoin': 'round' }), P('M11 6h2M11 18h2', { 'stroke-dasharray': '1 1.5' })],
  interlace: [C(9, 12, 5.5), P('M15 6.5a5.5 5.5 0 1 1-1.2 9.7', { 'stroke-linecap': 'round' }), P('M13.2 8.5a5.5 5.5 0 0 1 1.3 1.6')],
};
