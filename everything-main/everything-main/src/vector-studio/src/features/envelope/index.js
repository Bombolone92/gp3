/**
 * Envelope Distort: objects drawn bent into a shape, kept live.
 *
 *  - Object > Envelope Distort: Make with Warp (Alt+Shift+Mod+W), Make with
 *    Mesh (Alt+Mod+M), Make with Top Object (Alt+Mod+C); with envelopes
 *    selected the first two read Reset with Warp / Mesh
 *  - Release (contents plus the shape as a gray object), Envelope Options,
 *    Expand, and Edit Contents / Edit Envelope (also in the context menu and
 *    on double-click)
 *  - Direct Selection edits mesh points and handles on the canvas; the
 *    Mesh tool also adds and removes envelope mesh lines
 *  - a Properties panel section for the selected envelope
 */
import './styles.css';
import './envelope-live.js';
import { overlayHooks } from '../../render/overlay.js';
import { directSelectionHooks } from '../../tools/direct-selection.js';
import { selectionDoubleClickHooks } from '../../tools/selection.js';
import { PropertiesPanel } from '../../ui/panels/properties.js';
import { isEnvelope, editingContents } from './envelope-model.js';
import { canBeTop, releaseEnvelope, expandEnvelope } from './envelope-ops.js';
import { meshToolHooks } from '../mesh/mesh-tool.js';
import { drawEnvelopeOverlay, directPointerDown, directMarquee, meshToolPointerDown } from './envelope-edit.js';
import { warpDialog, meshDialog, makeWithTop, optionsDialog, toggleEditContents, envelopeSection, targetEnvelopes, resetting, makeTargets } from './envelope-ui.js';

const DIRECT_HOOK = { pointerDown: directPointerDown, marquee: directMarquee };
const MESH_TOOL_HOOK = { pointerDown: meshToolPointerDown };

/** Double-clicking an envelope with the Selection tool edits its contents. */
function editOnDoubleClick(tool, target) {
  if (!isEnvelope(target) || editingContents(target)) return false;
  tool.editor.select([target.id]);
  toggleEditContents(tool.app, { on: true });
  return true;
}

function canMakeTop(ed) {
  const ids = makeTargets(ed);
  if (ids.length < 2) return false;
  const ordered = ed.doc.sortByPaintOrder(ids);
  return canBeTop(ed.doc, ed.doc.get(ordered[ordered.length - 1]));
}

function registerCommands(app) {
  const envs = (a) => targetEnvelopes(a.editor);
  app.commands.register([
    {
      id: 'envelope.makeWarp',
      label: (a) => (resetting(a.editor) ? 'Reset with Warp...' : 'Make with Warp...'),
      shortcut: 'Alt+Shift+Mod+W',
      enabled: (a) => makeTargets(a.editor).length > 0,
      run: (a) => warpDialog(a),
    },
    {
      id: 'envelope.makeMesh',
      label: (a) => (resetting(a.editor) ? 'Reset with Mesh...' : 'Make with Mesh...'),
      shortcut: 'Alt+Mod+M',
      enabled: (a) => makeTargets(a.editor).length > 0,
      run: (a) => meshDialog(a),
    },
    {
      id: 'envelope.makeTop',
      label: 'Make with Top Object',
      shortcut: 'Alt+Mod+C',
      enabled: (a) => Boolean(a.editor) && canMakeTop(a.editor),
      run: (a) => makeWithTop(a),
    },
    {
      id: 'envelope.release',
      label: 'Release',
      enabled: (a) => envs(a).length > 0,
      run: (a) => {
        const ed = a.editor;
        const out = [];
        ed.doc.transact('Release Envelope', () => {
          for (const env of envs(a)) out.push(...releaseEnvelope(ed.doc, env.id));
        });
        ed.select(out.filter((id) => ed.doc.has(id)));
      },
    },
    {
      id: 'envelope.options',
      label: 'Envelope Options...',
      enabled: (a) => Boolean(a.editor),
      run: (a) => optionsDialog(a),
    },
    {
      id: 'envelope.expand',
      label: 'Expand',
      enabled: (a) => envs(a).length > 0,
      run: (a) => {
        const ed = a.editor;
        const out = [];
        ed.doc.transact('Expand Envelope', () => {
          for (const env of envs(a)) {
            const id = expandEnvelope(ed.doc, env.id);
            if (id) out.push(id);
          }
        });
        ed.select(out);
      },
    },
    {
      id: 'envelope.editContents',
      label: (a) => (envs(a).length && envs(a).every(editingContents) ? 'Edit Envelope' : 'Edit Contents'),
      enabled: (a) => envs(a).length > 0,
      run: (a) => toggleEditContents(a),
    },
  ]);
}

export function install(app) {
  registerCommands(app);
  overlayHooks.add(drawEnvelopeOverlay);
  if (!directSelectionHooks.includes(DIRECT_HOOK)) directSelectionHooks.push(DIRECT_HOOK);
  if (!meshToolHooks.includes(MESH_TOOL_HOOK)) meshToolHooks.push(MESH_TOOL_HOOK);
  if (!selectionDoubleClickHooks.includes(editOnDoubleClick)) selectionDoubleClickHooks.push(editOnDoubleClick);
  if (!PropertiesPanel.extraSections.some((s) => s.id === 'envelope')) PropertiesPanel.extraSections.push(envelopeSection());
}
