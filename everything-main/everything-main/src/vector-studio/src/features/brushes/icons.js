/** Original icons for the brushes feature (24px grid, 2px strokes, currentColor). */
import { registerIcons } from '../../ui/icons.js';

const fill = (d) => ['path', { d, fill: 'currentColor', stroke: 'none' }];

export function registerBrushIcons() {
  registerIcons({
    brushes: [['path', { d: 'M3 19c3 1 5-1 6.5-3.5S13 12 16 13' }], ['path', { d: 'm14 9 6-6M16.5 11.5 12.5 7.5' }], fill('M12.5 7.5 16.5 11.5 14.5 13.5c-1.2 1.2-3.3 1-4.5-.3-1.2-1.2-1.3-3.2-.1-4.4z')],
    'brush-remove': [['path', { d: 'M3 16c4 3 7-5 11-3s4 4 7 2' }], ['path', { d: 'M5 4l14 16' }]],
    'brush-stroke-options': [['path', { d: 'M3 9c4 3 7-5 11-3s4 4 7 2' }], ['path', { d: 'M4 18h16' }], ['circle', { cx: '14', cy: '18', r: '2', fill: 'var(--bg-panel, #fff)' }]],
    'flip-along': [['path', { d: 'M4 7h16M7 4 4 7l3 3M17 4l3 3-3 3' }], fill('M4 17.5 20 14v7z')],
    'flip-across': [['path', { d: 'M18 4v16M15 7l3-3 3 3M15 17l3 3 3-3' }], fill('M3 6l9 14H3z')],
  });
}
