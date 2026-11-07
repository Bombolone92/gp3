/**
 * View and Window menu features: Trim View, Presentation Mode, proofing,
 * view rotation presets, saved views, print tiling, global and video
 * rulers, template and overprint previews (view.js); workspaces, tool
 * sets, the Control bar, document windows and arrangement, and screen
 * modes (window.js).
 */
import './styles.css';
import { registerIcons } from '../../ui/icons.js';
import { installView } from './view.js';
import { installWindow } from './window.js';

const P = (d, extra = {}) => ['path', { d, ...extra }];

registerIcons({
  'tool-print-tiling': [['rect', { x: '3', y: '3', width: '8', height: '10', rx: '1' }], ['rect', { x: '13', y: '3', width: '8', height: '10', rx: '1', 'stroke-dasharray': '2 2' }], P('M12 16v5M9.5 18.5 12 21l2.5-2.5'), P('M3 16h6M15 16h6')],
});

export function install(app) {
  installView(app);
  installWindow(app);
}
