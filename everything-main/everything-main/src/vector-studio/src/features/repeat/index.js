/**
 * Repeats and Objects on Path:
 *
 *  - Object > Repeat > Radial / Grid / Mirror / Release / Options...
 *    (live groups, model in repeat-model.js), on-canvas widgets for the
 *    Selection tool, a Properties panel section and the Repeat Options
 *    dialog. Double-click a repeat (or Edit Source) to edit the source in
 *    isolation mode: every instance follows.
 *  - Object > Objects on Path > Attach... / Options... / Expand (on-path.js).
 */
import './styles.css';
import { registerIcons } from '../../ui/icons.js';
import { PropertiesPanel } from '../../ui/panels/properties.js';
import { expandLive } from '../../model/live.js';
import { FEATURE_ICONS } from './icons.js';
import { makeRepeat, releaseRepeat, isRepeat } from './repeat-model.js';
import { repeatSection, repeatOptionsDialog, selectedRepeats, repeatDefaults } from './repeat-ui.js';
import { installRepeatWidgets } from './repeat-widgets.js';
import { installObjectsOnPath } from './on-path-ui.js';

registerIcons(FEATURE_ICONS);

function registerRepeatCommands(app) {
  const hasSel = (a) => Boolean(a.editor?.topSelection().length);
  const make = (mode) => (a) => {
    const ed = a.editor;
    const ids = ed.topSelection().filter((id) => !ed.doc.isLocked(id));
    if (!ids.length) return;
    let gid = null;
    const label = { radial: 'Radial Repeat', grid: 'Grid Repeat', mirror: 'Mirror Repeat' }[mode];
    ed.doc.transact(label, () => {
      gid = makeRepeat(ed.doc, ids, mode, repeatDefaults(a)[mode]);
    });
    if (!gid) return;
    if (mode === 'mirror') {
      // Editing one side updates the other: start in isolation on the source.
      a.commands.run('object.isolate', { id: gid });
      ed.select(ed.doc.get(gid).children.slice());
    } else ed.select([gid]);
  };
  app.commands.register([
    { id: 'repeat.radial', label: 'Radial', enabled: hasSel, run: make('radial') },
    { id: 'repeat.grid', label: 'Grid', enabled: hasSel, run: make('grid') },
    { id: 'repeat.mirror', label: 'Mirror', enabled: hasSel, run: make('mirror') },
    {
      id: 'repeat.release',
      label: 'Release',
      enabled: (a) => selectedRepeats(a.editor).length > 0,
      run: (a) => {
        const ed = a.editor;
        const ids = selectedRepeats(ed);
        if (ed.isolation && ids.some((id) => id === ed.isolation || ed.doc.isAncestor(id, ed.isolation))) a.commands.run('object.exitIsolation');
        const out = [];
        ed.doc.transact('Release Repeat', () => ids.forEach((id) => out.push(...releaseRepeat(ed.doc, id))));
        ed.select(out);
      },
    },
    { id: 'repeat.options', label: 'Options...', enabled: (a) => Boolean(a.editor), run: (a) => repeatOptionsDialog(a) },
    {
      id: 'repeat.edit',
      label: 'Edit Repeat Source',
      enabled: (a) => selectedRepeats(a.editor).length === 1 && a.editor.isolation !== selectedRepeats(a.editor)[0],
      run: (a) => {
        const id = selectedRepeats(a.editor)[0];
        a.commands.run('object.isolate', { id });
        a.editor.select(a.editor.doc.get(id).children.slice());
      },
    },
    {
      id: 'repeat.expand',
      label: 'Expand Repeat',
      enabled: (a) => selectedRepeats(a.editor).length > 0,
      run: (a) => {
        const ed = a.editor;
        const ids = selectedRepeats(ed).filter((id) => isRepeat(ed.doc.get(id)));
        const out = [];
        ed.doc.transact('Expand', () => ids.forEach((id) => out.push(expandLive(ed.doc, id)?.id)));
        ed.select(out.filter(Boolean));
      },
    },
  ]);
}

export function install(app) {
  registerRepeatCommands(app);
  installRepeatWidgets(app);
  if (!PropertiesPanel.extraSections.some((s) => s.id === 'repeat')) PropertiesPanel.extraSections.push(repeatSection(app));
  installObjectsOnPath(app);
}
