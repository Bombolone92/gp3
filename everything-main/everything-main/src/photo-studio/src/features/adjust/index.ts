// Adjustment layers, their Properties editors, the Adjustments panel and the
// destructive Image > Adjustments commands.
import type { Editor } from '../../editor';
import type { Layer } from '../../model/document';
import { registerPanel } from '../../app/registry';
import { ADJUSTMENT_KINDS } from '../../imaging/adjust';
import { registerAdjustmentCompiler, registerSpatialAdjustment } from '../../renderer/renderer';
import { propertiesEditors } from '../panels/properties';
import { compileSpatial, compileSpec } from './compile';
import { adjustmentsPanel, registerAdjustmentLayerCommands } from './layers';
import { lazy, prefetchOnIdle } from '../../app/lazy';
import { findLayer } from '../../model/document';
import { registerDestructiveCommands } from './destructive';

// The Properties editors of adjustment layers load with the first one shown
// (and are fetched when the workspace is idle).
const layerEditor = lazy(() => import('./layer-editor'));

export function installAdjust(e: Editor) {
  registerAdjustmentCompiler(compileSpec);
  registerSpatialAdjustment(compileSpatial);
  registerAdjustmentLayerCommands(e);
  registerDestructiveCommands(e);
  const mount = (e: Editor, el: HTMLElement, l: Layer) => {
    const m = layerEditor.loaded;
    if (m) return m.mountLayerEditor(e, el, l);
    const key = el.dataset.key;
    el.classList.add('panel-loading');
    void layerEditor().then((m) => {
      el.classList.remove('panel-loading');
      // Still showing the same layer: mount its editor now.
      const now = findLayer(e.doc.layers, l.id);
      if (el.isConnected && el.dataset.key === key && now) m.mountLayerEditor(e, el, now);
    });
  };
  for (const kind of ADJUSTMENT_KINDS) propertiesEditors.set(`adjustment:${kind}`, { mount });
  registerPanel(adjustmentsPanel);
  e.onUpdate(() => layerEditor.loaded?.refreshLayerEditor());
  prefetchOnIdle(layerEditor);
}
