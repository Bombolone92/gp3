/**
 * How tracked changes show on the page: with the suggestions marked up
 * (insertions and deletions visible, the engine's review view), or the
 * original text as it stood before them. The engine keeps no readable
 * preference, so the view is tracked here per editor.
 */

export const MARKUP_VIEWS = [
  { id: 'review', label: 'Show suggestions', hint: 'Insertions and deletions marked on the page' },
  { id: 'original', label: 'Show original', hint: 'The text as it was before the suggestions' },
];

export function isMarkupView(id) {
  return MARKUP_VIEWS.some((v) => v.id === id);
}

/** Switch the engine's view; resolves whether the call was made. */
export function applyMarkupView(controller, id) {
  if (!controller?.setTrackedChangesPreferences || !isMarkupView(id)) return false;
  try { controller.setTrackedChangesPreferences({ mode: id, enabled: true }); } catch (e) { console.error(e); return false; }
  return true;
}
