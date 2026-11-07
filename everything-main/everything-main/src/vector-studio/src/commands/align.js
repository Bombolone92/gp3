/**
 * Align and Distribute commands (Align panel, Properties panel, Object >
 * Align). `app.alignTo` is 'selection' (default) or 'artboard'; with a key
 * object set in the Align panel, objects align to it.
 */
import { align, distribute } from '../ops/object-ops.js';

const EDGES = {
  left: 'Horizontal Align Left',
  hcenter: 'Horizontal Align Center',
  right: 'Horizontal Align Right',
  top: 'Vertical Align Top',
  vcenter: 'Vertical Align Center',
  bottom: 'Vertical Align Bottom',
};

const DIST = {
  left: 'Horizontal Distribute Left',
  hcenter: 'Horizontal Distribute Center',
  right: 'Horizontal Distribute Right',
  top: 'Vertical Distribute Top',
  vcenter: 'Vertical Distribute Center',
  bottom: 'Vertical Distribute Bottom',
  hspace: 'Horizontal Distribute Space',
  vspace: 'Vertical Distribute Space',
};

export function registerAlignCommands(app) {
  const opts = () => ({
    to: app.alignKey && app.editor?.selection.has(app.alignKey) ? 'key' : app.alignTo || 'selection',
    key: app.alignKey && app.editor?.selection.has(app.alignKey) ? app.alignKey : null,
    previewBounds: app.prefs.get('previewBounds'),
  });
  for (const [edge, label] of Object.entries(EDGES)) {
    app.commands.register({ id: `align.${edge}`, label, enabled: (a) => Boolean(a.editor?.selection.size), run: (a) => align(a.editor, edge, opts()) });
  }
  for (const [edge, label] of Object.entries(DIST)) {
    app.commands.register({
      id: `distribute.${edge}`,
      label,
      enabled: (a) => (a.editor?.topSelection().length || 0) >= 3 || ((a.editor?.topSelection().length || 0) >= 2 && a.distributeSpacing != null),
      run: (a) => distribute(a.editor, edge, { ...opts(), spacing: a.distributeSpacing ?? null }),
    });
  }
}
