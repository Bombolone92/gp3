import type { Editor } from '../../editor';
import { contributeMenu, registerCommand } from '../../app/registry';
import { lazy, lazyRun } from '../../app/lazy';
import { installArtboards } from './artboards';
import { installFrames } from './frames';
import { installLayerComps } from './comps';
import { installSlices } from './slices';

const copyCode = lazy(() => import('./copy-code'));

// Artboards, frames, layer comps, slices (with Export for Web) and copying a
// layer as CSS or SVG.
export function installLayout(e: Editor) {
  installArtboards(e);
  installFrames(e);
  installLayerComps(e);
  installSlices(e);
  // Layer → Copy CSS / Copy SVG put code for the selected layers on the
  // clipboard, or show it in a dialog when the clipboard is unavailable.
  const enabled = (e: Editor) => e.hasDocument && e.selectedLayers.length > 0;
  registerCommand(
    { id: 'layer.copy-css', label: 'Copy CSS', description: 'Copy CSS for the selected shapes, text and layers', enabled, recordable: false, ...lazyRun(copyCode, (m, e) => m.copyCss(e)) },
    { id: 'layer.copy-svg', label: 'Copy SVG', description: 'Copy the selected layers as SVG markup', enabled, recordable: false, ...lazyRun(copyCode, (m, e) => m.copySvg(e)) },
  );
  // One contribution keeps the page exporters together and in order.
  contributeMenu('file.export', ['-', 'file.export-artboards-files', 'file.export-artboards-pdf', 'file.export-comps-files', 'file.export-comps-pdf', '-'], 'file.export-gif');
}
