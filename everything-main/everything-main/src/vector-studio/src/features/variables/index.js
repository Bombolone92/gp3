/** Variables feature: the Variables panel for data-driven artwork. */
import './styles.css';
import { registerIcons } from '../../ui/icons.js';
import { VariablesPanel } from './panel.js';

registerIcons({
  'panel-variables': [['path', { d: 'M8 4c-2 0-3 1-3 3v2c0 1.5-.8 2.5-2 3 1.2.5 2 1.5 2 3v2c0 2 1 3 3 3' }], ['path', { d: 'M16 4c2 0 3 1 3 3v2c0 1.5.8 2.5 2 3-1.2.5-2 1.5-2 3v2c0 2-1 3-3 3' }], ['path', { d: 'm9.5 9 5 6M14.5 9l-5 6' }]],
  camera: [['path', { d: 'M4 8h3l1.5-2h7L17 8h3v11H4z', 'stroke-linejoin': 'round' }], ['circle', { cx: '12', cy: '13', r: '3.5' }]],
});

export function install(app) {
  app.registerPanel(VariablesPanel);
}
