// Controls laid over the canvas, such as comment pins and link badges, are
// kept in reading order in the page, top to bottom and then left to right on
// the board, so Tab visits them as they appear. Board coordinates keep the
// order the same while the view pans or zooms, so nodes move only when a
// control enters the view or its object moves.
export function keepReadingOrder(layer, entries) {
  entries.sort((a, b) => a.y - b.y || a.x - b.x);
  const focused = layer.ownerDocument.activeElement;
  let next = layer.firstElementChild,
    refocus = false;
  for (const { node } of entries) {
    if (node === next) {
      next = next.nextElementSibling;
      continue;
    }
    // Moving a node takes focus from it; it gets focus back below.
    if (node === focused) refocus = true;
    layer.insertBefore(node, next);
  }
  if (refocus) focused.focus({ preventScroll: true });
}
