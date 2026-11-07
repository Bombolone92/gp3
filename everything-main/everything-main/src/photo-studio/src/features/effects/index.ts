import type { Editor } from '../../editor';
import { registerPanel, registerTool } from '../../app/registry';
import { registerStyleRenderer } from '../../renderer/layer-style';
import { propertiesEditors } from '../panels/properties';
import { workerStyleRenderer } from './style-client';
import { installEffectCommands } from './commands';
import { gradientTool } from './gradient-tool';
import { patternStampTool } from './pattern-stamp';
import { gradientsPanel, patternsPanel, stylesPanel } from './panels';
import { fillPropertiesEditor } from './fill-properties';
import { bindLayerEffects } from './layer-effects';

// Layer styles, gradients, patterns and fill layers.
export function installEffects(e: Editor) {
  registerStyleRenderer(workerStyleRenderer());
  installEffectCommands();
  registerTool(gradientTool, patternStampTool);
  registerPanel(stylesPanel, gradientsPanel, patternsPanel);
  propertiesEditors.set('fill', fillPropertiesEditor);
  bindLayerEffects(e);
  // The canvas shows ready effects while new ones render; exports wait.
  e.onUpdate(() => {
    if (e.renderer) e.renderer.progressiveStyles = true;
  });
}
