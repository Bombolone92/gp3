/** Original icons for the 3D effects (24px grid, 2px strokes, currentColor). */
import { registerIcons } from '../../ui/icons.js';

export function registerThreeDIcons() {
  registerIcons({
    // A cube seen from above a corner.
    'three-d': [['path', { d: 'M12 3 20 7.5v9L12 21l-8-4.5v-9z' }], ['path', { d: 'M4 7.5 12 12l8-4.5M12 12v9' }]],
    // A flat card leaning back in space.
    'three-d-rotate': [['path', { d: 'M6 5h12l-2 14H4z' }], ['path', { d: 'M17 3.5a8 8 0 0 1 3.5 5', 'stroke-dasharray': '2 2' }]],
    // A slab with its depth shown.
    'three-d-extrude': [['path', { d: 'M4 9h11v11H4z' }], ['path', { d: 'M4 9l5-5h11v11l-5 5M15 9l5-5' }]],
    // A vase shape turned around a dashed axis.
    'three-d-revolve': [['path', { d: 'M12 2v20', 'stroke-dasharray': '2 2.5' }], ['ellipse', { cx: '12', cy: '6', rx: '6', ry: '2' }], ['path', { d: 'M6 6c0 5 3 6 3 9s-2 3-2 4.5S9 21 12 21s5-.2 5-1.5-2-1.5-2-4.5 3-4 3-9' }]],
    // A puffy cushion.
    'three-d-inflate': [['path', { d: 'M5 6c3-2 11-2 14 0 2 3 2 9 0 12-3 2-11 2-14 0-2-3-2-9 0-12z' }], ['path', { d: 'M8.5 9.5c1.5-1 3-1 4.5-.6' }]],
    // A sun-like light source over a sphere.
    'three-d-light': [['circle', { cx: '12', cy: '14', r: '6' }], ['path', { d: 'M5 4l2 2M12 2v2.5M19 4l-2 2' }]],
    // A shaded ball.
    'three-d-material': [['circle', { cx: '12', cy: '12', r: '8' }], ['path', { d: 'M8.5 9a4 4 0 0 1 3-2.2', 'stroke-width': '2.5' }], ['path', { d: 'M8 18.5a8 8 0 0 0 12-6.5' }]],
  });
}
