// Option-bar controls shared by the Clone Stamp and the Healing Brush.
import type { Editor } from '../../editor';
import { activeSource, cloneSourceChanged, ignoreAdjustments, sampleMode, warmSource } from './state';

export const sampleOptions = (key: string, value: string) =>
  `<label>Sample <select id="${key}"><option value="current">Current Layer</option><option value="below" ${value === 'below' ? 'selected' : ''}>Current &amp; Below</option><option value="all" ${value === 'all' ? 'selected' : ''}>All Layers</option></select></label>`;

export function bindSampleOptions(e: Editor, el: HTMLElement, tool: 'clone' | 'heal') {
  el.querySelector<HTMLInputElement>(`#${tool}-aligned`)?.addEventListener('change', (ev) => {
    e.settings[tool === 'clone' ? 'cloneAligned' : 'healAligned'] = (ev.target as HTMLInputElement).checked;
    const src = activeSource();
    if (src) src.offset = undefined;
    cloneSourceChanged();
  });
  el.querySelector<HTMLSelectElement>(`#${tool}-sample`)?.addEventListener('change', (ev) => {
    e.settings[tool === 'clone' ? 'cloneSample' : 'healSample'] = (ev.target as HTMLSelectElement).value;
    warmSource(e, sampleMode(e, tool));
    e.overlay();
  });
  el.querySelector<HTMLButtonElement>(`#${tool}-ignore-adj`)?.addEventListener('click', () => {
    e.settings.cloneIgnoreAdjustments = !ignoreAdjustments(e);
    warmSource(e, sampleMode(e, tool));
    e.options();
  });
  el.querySelector<HTMLButtonElement>(`#${tool}-panel`)?.addEventListener('click', () => e.dock.show('clone-source'));
}
