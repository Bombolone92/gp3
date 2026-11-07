// Pure decision extracted from main.js's load-time restore block. No DOM,
// no localStorage, no puter — just the timestamp/ownership arithmetic that
// decides whether a remote save should replace what's already on screen.
//
// playerOwnsBoard: true once the player has committed to the current board
// (a move, an undo, a stock draw, or a fresh deal via New) since this page
// load. Once true, the remote is never adopted, full stop — the player's
// in-memory game is authoritative regardless of timestamps.
//
// bootTs / remoteTs: missing/absent timestamps are treated as 0, so an
// unsaved boot state never loses to a remote save with no timestamp either.
export function shouldAdoptRemote({ bootTs, remoteTs, playerOwnsBoard }) {
  if (playerOwnsBoard) return false;
  return (remoteTs || 0) > (bootTs || 0);
}
