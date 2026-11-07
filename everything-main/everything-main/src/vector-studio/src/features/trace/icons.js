/** Original icons for tracing and image commands (24px grid, 2px strokes, currentColor). */
import { registerIcons } from '../../ui/icons.js';

const fill = (d) => ['path', { d, fill: 'currentColor', stroke: 'none' }];

export function registerTraceIcons() {
  registerIcons({
    // A pixel stair turning into a smooth curve.
    'trace-image': [['path', { d: 'M3 21v-4h3v-3h3v-3h3' }], ['path', { d: 'M12 11c4 0 7-3 9-8' }], ['circle', { cx: '12', cy: '11', r: '1.5' }]],
    // Quick presets.
    'trace-auto': [['circle', { cx: '8', cy: '9', r: '4.5' }], ['circle', { cx: '16', cy: '9', r: '4.5' }], ['circle', { cx: '12', cy: '15.5', r: '4.5' }]],
    'trace-photo-high': [['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }], ['path', { d: 'M3 16l5-5 4 4 3-3 6 6' }], ['circle', { cx: '16', cy: '9', r: '1.5' }]],
    'trace-photo-low': [['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }], ['path', { d: 'M3 17l7-6 11 8' }]],
    'trace-grays': [['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }], fill('M5 6h4v12H5z'), ['path', { d: 'M12 6v12', 'stroke-dasharray': '1.5 1.5' }]],
    'trace-bw': [['circle', { cx: '12', cy: '12', r: '9' }], fill('M12 3a9 9 0 0 1 0 18z')],
    'trace-line-art': [['path', { d: 'M4 18c3-9 6-12 9-10s-1 7 2 8 4-6 5-9' }]],
    // View and info.
    'trace-compare': [['path', { d: 'M12 3v18' }], ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }], fill('M4 6h8v12H4z')],
    'trace-paths': [['path', { d: 'M4 19c2-9 7-14 16-14' }], ['rect', { x: '2.5', y: '17.5', width: '3', height: '3' }], ['rect', { x: '18.5', y: '3.5', width: '3', height: '3' }]],
    'trace-anchors': [['path', { d: 'M3 18 9 7l6 9 6-11' }], fill('M7.5 5.5h3v3h-3zM13.5 14.5h3v3h-3z')],
    'trace-colors': [['rect', { x: '3', y: '3', width: '8', height: '8', rx: '1' }], ['rect', { x: '13', y: '3', width: '8', height: '8', rx: '1' }], ['rect', { x: '3', y: '13', width: '8', height: '8', rx: '1' }], fill('M14 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z')],
    // Image commands.
    'image-crop': [['path', { d: 'M6 2v16h16' }], ['path', { d: 'M2 6h16v16' }], ['path', { d: 'M9 13l3-3 3 3', 'stroke-width': '1.5' }]],
    'image-mosaic': [['rect', { x: '3', y: '3', width: '5', height: '5' }], fill('M10 3h5v5h-5z'), ['rect', { x: '17', y: '3', width: '4', height: '5' }], fill('M3 10h5v5H3z'), ['rect', { x: '10', y: '10', width: '5', height: '5' }], fill('M17 10h4v5h-4z'), ['rect', { x: '3', y: '17', width: '5', height: '4' }], fill('M10 17h5v4h-5z'), ['rect', { x: '17', y: '17', width: '4', height: '4' }]],
    'pixel-perfect': [['path', { d: 'M4 4v16M10 4v16M16 4v16M4 4h16M4 10h16M4 16h16', 'stroke-width': '1', opacity: '0.5' }], ['path', { d: 'M7 19V7h10' }]],
    'image-embed': [['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }], ['path', { d: 'M12 8v8M8.5 12.5 12 16l3.5-3.5' }]],
  });
}
