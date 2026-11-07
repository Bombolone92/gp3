/**
 * The turns that continue a jump sequence already partly played. Splitting
 * this out of the controller keeps the one piece of genuinely new logic in
 * the port testable without a DOM.
 */
export function continuations(moves, pendingPath) {
  if (pendingPath.length === 0) return moves;
  return moves.filter(
    (m) =>
      m.path.length >= pendingPath.length &&
      pendingPath.every((sq, i) => m.path[i] === sq),
  );
}

/** The next-hop squares of `moves`, mapped to whether that hop captures. */
export function nextHops(moves, step) {
  const map = new Map();
  for (const move of moves) {
    if (move.path.length > step) map.set(move.path[step], move.captured.length > 0);
  }
  return map;
}
