import type { Editor } from '../../editor';
import { registerOverlay, registerPanel, registerTool, type Tool } from '../../app/registry';
import { lazy, lazyTool } from '../../app/lazy';
import { shapeOpts, type ShapeKind } from './shape-options';
import { pathOverlay } from './overlay';
import { pathsPanel } from './panel';
import { installVectorCommands } from './commands';
import { installVectorProperties } from './properties';
import { installKeys } from './keys';
import { guardTool } from './guard';
import { installShapesPanel } from './shapes-panel';

// The tools' implementations load when one is first chosen.
const penTools = lazy(() => import('./pen-tools'));
const selectTools = lazy(() => import('./select-tools'));
const shapeTools = lazy(() => import('./shape-tools'));
type Meta = Parameters<typeof lazyTool>[0];
const fromModule = <M,>(meta: Meta, mod: () => Promise<M>, pick: (m: M) => Tool) => lazyTool(meta, lazy(async () => pick(await mod())));
const shape = (id: string, label: string, icon: string, kind: ShapeKind) =>
  fromModule({ id, label, key: 'U', icon, group: 'shape' }, shapeTools, (m) => m.shapeTool(id, label, icon, kind));

// Pen, shape and path selection tools, the Paths panel, vector masks and the
// shape layer Properties editor. Shapes use the PSD-compatible vector model.
export function installVector(e: Editor) {
  installKeys();
  // Path tools wait for queued vector-mask commits before reading paths.
  const tools = [
    fromModule({ id: 'pen', label: 'Pen Tool', key: 'P', icon: 'pen-tool', group: 'pen' }, penTools, (m) => m.penTool),
    fromModule({ id: 'freeform-pen', label: 'Freeform Pen Tool', key: 'P', icon: 'pen-freeform', group: 'pen' }, penTools, (m) => m.freeformPenTool),
    fromModule({ id: 'curvature-pen', label: 'Curvature Pen Tool', key: 'P', icon: 'pen-curvature', group: 'pen' }, penTools, (m) => m.curvaturePenTool),
    fromModule({ id: 'add-anchor', label: 'Add Anchor Point Tool', icon: 'anchor-add', group: 'pen' }, penTools, (m) => m.addAnchorTool),
    fromModule({ id: 'delete-anchor', label: 'Delete Anchor Point Tool', icon: 'anchor-delete', group: 'pen' }, penTools, (m) => m.deleteAnchorTool),
    fromModule({ id: 'convert-point', label: 'Convert Point Tool', icon: 'anchor-convert', group: 'pen' }, penTools, (m) => m.convertPointTool),
    fromModule({ id: 'path-select', label: 'Path Selection Tool', key: 'A', icon: 'path-select', group: 'path-select' }, selectTools, (m) => m.pathSelectTool),
    fromModule({ id: 'direct-select', label: 'Direct Selection Tool', key: 'A', icon: 'direct-select', group: 'path-select' }, selectTools, (m) => m.directSelectTool),
    shape('rect-shape', 'Rectangle Tool', 'square', 'rect'),
    shape('ellipse-shape', 'Ellipse Tool', 'circle', 'ellipse'),
    shape('triangle-shape', 'Triangle Tool', 'triangle', 'triangle'),
    shape('polygon-shape', 'Polygon Tool', 'shape-polygon', 'polygon'),
    shape('line-shape', 'Line Tool', 'shape-line', 'line'),
    shape('custom-shape', 'Custom Shape Tool', 'shape-custom', 'custom'),
  ];
  registerTool(...tools.map(guardTool));
  registerPanel(pathsPanel);
  registerOverlay('vector-paths', pathOverlay);
  installVectorCommands();
  installVectorProperties(e);
  installShapesPanel(e);
  // The shape tools' Align Edges option follows Tools → Snap vector tools to pixel grid.
  let snap = e.preferences.snapPixelGrid;
  if (snap) shapeOpts.alignEdges = true;
  e.preferenceHooks.push(() => {
    if (e.preferences.snapPixelGrid === snap) return;
    snap = shapeOpts.alignEdges = e.preferences.snapPixelGrid;
  });
}
