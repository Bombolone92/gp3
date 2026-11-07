// Mixer Brush and Art History Brush.
import type { Editor } from '../../editor';
import { registerTool } from '../../app/registry';
import { installMixerCommands, mixerBrushTool } from './mixer';
import { artHistoryTool } from './art-history';
import './paint-tools.css';

export function installPaintTools(e: Editor) {
  registerTool(mixerBrushTool(), artHistoryTool());
  installMixerCommands();
  void e;
}
