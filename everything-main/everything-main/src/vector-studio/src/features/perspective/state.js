/**
 * Per-document view state of the perspective grid: shown or hidden, the
 * active plane, rulers, snapping and the locks. The grid itself is part of
 * the document (model.js); these are view settings, kept on the editor,
 * with snapping, rulers and the station lock remembered as preferences.
 */

export const PLANE_KEYS = ['left', 'right', 'floor', 'none'];

const listeners = new Set();

/** The perspective view state of an editor. */
export function pstate(editor) {
  if (!editor.perspective) {
    const p = editor.prefs;
    const pref = (k, d) => {
      const v = p?.get?.(k);
      return v === undefined || v === null ? d : v;
    };
    editor.perspective = {
      visible: false,
      plane: 'left',
      rulers: Boolean(pref('perspectiveRulers', false)),
      snap: Boolean(pref('perspectiveSnap', true)),
      lock: false,
      lockStation: Boolean(pref('perspectiveLockStation', false)),
    };
  }
  return editor.perspective;
}

/** Change the view state and redraw. */
export function setPState(editor, patch) {
  const s = pstate(editor);
  Object.assign(s, patch);
  const p = editor.prefs;
  if (p?.set) {
    if ('rulers' in patch) p.set('perspectiveRulers', s.rulers);
    if ('snap' in patch) p.set('perspectiveSnap', s.snap);
    if ('lockStation' in patch) p.set('perspectiveLockStation', s.lockStation);
  }
  editor.emit('overlay');
  for (const fn of listeners) fn(editor, patch);
}

/** Listen to view state changes: fn(editor, patch). */
export function onPState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The plane new artwork goes on, or null (grid hidden or no active plane). */
export function activePlane(editor) {
  const s = pstate(editor);
  return s.visible && s.plane !== 'none' ? s.plane : null;
}
