import type { Editor } from '../../editor';
import { commandId } from './menu';
import { filterState } from './state';

// Commands that open a dialog are recorded when the dialog is confirmed, with
// the settings used, so playback applies them without asking. The Actions panel
// installs `e.recorder` while recording; a wrapper drops the bare menu
// invocation of these commands and translates Last Filter into the filter it
// repeated.
const deferred = new Set<string>();
let raw: Editor['recorder'];

export function deferRecording(id: string) {
  deferred.add(id);
}
export function installRecorderWrapper(e: Editor) {
  raw = e.recorder;
  const wrapped = (id: string, arg?: unknown) => {
    if (!raw) return;
    if (id === 'filter.last') {
      const last = filterState.last;
      if (last) raw(commandId(last.opId), { params: last.params });
      return;
    }
    const hasParams = !!arg && typeof arg === 'object' && 'params' in (arg as object);
    if (deferred.has(id) && !hasParams) return;
    raw(id, arg);
  };
  Object.defineProperty(e, 'recorder', {
    configurable: true,
    enumerable: true,
    get: () => (raw ? wrapped : undefined),
    set: (v: Editor['recorder']) => {
      raw = v;
    },
  });
}
/** Record a confirmed dialog as a step with its settings. */
export function recordStep(e: Editor, id: string, arg: unknown) {
  e.recorder?.(id, arg);
}
