/**
 * On-canvas widgets: handles that feature modules draw over a selected
 * object to edit its parameters directly (a repeat's radius and instance
 * count, a mirror axis, a path offset). The Selection tool asks them first,
 * so a widget handle wins over the bounding box and the artwork below it.
 *
 *   canvasWidgets.add({
 *     hit(editor, e) -> handle | null      e: tool event (doc x/y, screen sx/sy)
 *   })
 *
 * A handle is { id, cursor?, tip?, begin(e) -> { move(e), end(e), cancel() } }.
 * `editor.widgetHover` holds the id of the handle under the pointer, for the
 * widget's own overlay drawing.
 */
export const canvasWidgets = new Set();

/** The topmost widget handle under the pointer, or null. */
export function widgetAt(editor, e) {
  if (!editor) return null;
  const list = [...canvasWidgets];
  for (let i = list.length - 1; i >= 0; i--) {
    let h = null;
    try {
      h = list[i].hit(editor, e);
    } catch (err) {
      console.warn('Canvas widget failed', err);
    }
    if (h) return h;
  }
  return null;
}
