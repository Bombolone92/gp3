// Measurement and annotation: Color Sampler, Ruler, Count and Note tools
// (sharing the Eyedropper slot), the Info, Notes and Measurement Log panels,
// Image > Analysis, ruler units and View > Show toggles.
import type { Editor } from '../../editor';
import { contributeMenu, registerCommand } from '../../app/registry';
import { RULER_UNITS } from '../../imaging/measure/geometry';
import { installSamplers, clearSamplers } from './samplers';
import { installRuler } from './ruler';
import { installCount } from './count';
import { installNotes } from './notes';
import { installAnalysis } from './analysis';
import { installInfo, setUnits } from './info';
import { annotationsOf, rulerUnit, watchPreviews } from './state';

export function installMeasure(e: Editor) {
  installInfo(e);
  installSamplers(e);
  installRuler(e);
  installCount(e);
  installNotes(e);
  installAnalysis(e);
  // The Info panel shows before/after values while a dialog previews a change.
  watchPreviews(e, () => !!e.dock?.isVisible('info'));

  const toggle = (key: string) => (e: Editor) => {
    e.settings[key] = !e.settings[key];
    e.overlay();
  };
  registerCommand(
    { id: 'samplers.clear', label: 'Delete All Color Samplers', enabled: (e) => !!annotationsOf(e.doc).samplers?.length, run: (e) => clearSamplers(e) },
    { id: 'view.show-count', label: 'Count', checked: (e) => !e.settings.hideCounts, run: toggle('hideCounts'), recordable: false },
    { id: 'view.show-samplers', label: 'Color Samplers', checked: (e) => !e.settings.hideSamplers, run: toggle('hideSamplers'), recordable: false },
    ...RULER_UNITS.map(([id, label], i) => ({
      id: `view.ruler-units-${id}`,
      label,
      menu: 'view.ruler-units',
      order: i,
      checked: (e: Editor) => rulerUnit(e) === id,
      run: (e: Editor) => setUnits(e, id),
      recordable: false,
    })),
  );
  contributeMenu('view', [{ label: 'Ruler Units', id: 'view.ruler-units', items: [] }], 'view.rulers');
  // Right-click a ruler to change its units.
  for (const sel of ['#ruler-x', '#ruler-y'])
    e.el(sel).addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      void import('../../app/menubar').then(({ showContextMenu }) => showContextMenu(e, ev.clientX, ev.clientY, RULER_UNITS.map(([id]) => `view.ruler-units-${id}`)));
    });
}
