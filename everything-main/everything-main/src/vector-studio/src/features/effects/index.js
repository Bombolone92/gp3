/**
 * Vector effects feature: the Effect menu's live geometry effects (Distort
 * & Transform, Path, Convert to Shape, Warp, Scribble, Crop Marks,
 * Pathfinder), geometry effects on type, Effect > Rasterize and the
 * document's raster effects settings, Object > Rasterize and Object >
 * Flatten Transparency.
 *
 * Effects are records in node.effects (see registry.js); the dialogs edit
 * them with a live preview, and the Appearance panel lists, hides, edits,
 * reorders and deletes them.
 *
 * Hooks for other modules:
 *   app.showEffectMenu(anchor)   the Add New Effect menu (every effect command)
 */
import './styles.css';
import './registry.js';
import './text-effects.js';
import { EFFECTS } from '../paint/effects-model.js';
import { onGeomEffectsChanged } from '../../model/geom-effects.js';
import { WARP_STYLES } from '../../model/warp.js';
import { MENUS } from '../../ui/menus.js';
import { EFFECT_DIALOGS } from './dialogs.js';
import { addEffectNow } from './dialog-kit.js';
import { PATHFINDER_EFFECTS } from './geom/engine.js';
import { rasterSettingsDialog, rasterizeEffectDialog, rasterizeObjectDialog } from './raster.js';
import { flattenDialog } from './flatten.js';
import { registerEffectIcons } from './icons.js';

const hasSel = (a) => Boolean(a.editor && a.editor.selection.size);

const SHAPES = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'roundedRectangle', label: 'Rounded Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
];

/** The Effect menu's effect entries (without Apply Last / Last / settings), for Add New Effect menus. */
export function effectMenuSpec() {
  const effect = MENUS.find((m) => m.label === 'Effect');
  const skip = new Set(['effect.applyLast', 'effect.last', 'effect.rasterSettings']);
  const out = [];
  for (const item of effect?.submenu || []) {
    if (typeof item === 'string' && skip.has(item)) continue;
    if (item === '-' && (!out.length || out[out.length - 1] === '-')) continue;
    out.push(item);
  }
  return out;
}

export function install(app) {
  registerEffectIcons();

  for (const [type, open] of Object.entries(EFFECT_DIALOGS)) EFFECTS[type].openDialog = open;
  EFFECTS.rasterize.openDialog = rasterizeEffectDialog;
  // Effects without options apply at once; there is nothing to edit later.
  for (const type of ['outlineObject', 'outlineStroke', 'cropMarks', 'pathfinder']) {
    EFFECTS[type].openDialog = (a, { params, edit } = {}) => {
      if (edit) {
        a.notify(`${EFFECTS[type].label} has no options.`, { polite: true });
        return false;
      }
      return addEffectNow(a, type, params || {});
    };
  }

  const dialog = (type, params) => (a) => EFFECTS[type].openDialog(a, { params });
  const cmds = [
    { id: 'effect.freeDistort', label: 'Free Distort...', run: dialog('freeDistort') },
    { id: 'effect.pucker', label: 'Pucker & Bloat...', run: dialog('puckerBloat') },
    { id: 'effect.roughen', label: 'Roughen...', run: dialog('roughen') },
    { id: 'effect.transform', label: 'Transform...', run: dialog('transform') },
    { id: 'effect.tweak', label: 'Tweak...', run: dialog('tweak') },
    { id: 'effect.twist', label: 'Twist...', run: dialog('twist') },
    { id: 'effect.zigzag', label: 'Zig Zag...', run: dialog('zigzag') },
    { id: 'effect.offsetPath', label: 'Offset Path...', run: dialog('offsetPath') },
    { id: 'effect.outlineObject', label: 'Outline Object', run: dialog('outlineObject') },
    { id: 'effect.outlineStroke', label: 'Outline Stroke', run: dialog('outlineStroke') },
    { id: 'effect.cropMarks', label: 'Crop Marks', run: dialog('cropMarks') },
    { id: 'effect.scribble', label: 'Scribble...', run: dialog('scribble') },
    { id: 'effect.rasterize', label: 'Rasterize...', run: dialog('rasterize') },
    ...SHAPES.map((s) => ({ id: `effect.shape.${s.id}`, label: `${s.label}...`, run: dialog('convertShape', { shape: s.id }) })),
    ...WARP_STYLES.map((s) => ({ id: `effect.warp.${s.id}`, label: `${s.label}...`, run: dialog('warp', { style: s.id }) })),
    ...PATHFINDER_EFFECTS.map((k) => ({ id: `effect.pathfinder.${k.kind}`, label: k.label, run: dialog('pathfinder', { kind: k.kind }) })),
  ].map((c) => ({ enabled: hasSel, ...c }));
  cmds.push(
    { id: 'effect.rasterSettings', label: 'Document Raster Effects Settings...', enabled: (a) => Boolean(a.editor), run: (a) => rasterSettingsDialog(a) },
    { id: 'object.rasterize', label: 'Rasterize...', enabled: hasSel, run: (a) => rasterizeObjectDialog(a) },
    { id: 'object.flatten', label: 'Flatten Transparency...', enabled: hasSel, run: (a) => flattenDialog(a) },
  );
  app.commands.register(cmds);

  app.showEffectMenu = (anchor) => app.showMenuAt(anchor, effectMenuSpec(), 'Add New Effect');

  // Results computed in the background (engine jobs, type outlines) redraw every view.
  onGeomEffectsChanged(() => {
    for (const v of app.views.values()) v.invalidate();
    app.editor?.emit('overlay');
  });
}
