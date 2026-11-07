import { textLinkURL } from "./text-link-data.js";
import { workerURL, ID } from "./collaboration/protocol.js";

const identifier = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\u0000-\u001f\u007f]/u.test(value);
export function validObjectLink(link) {
  return (
    !!link &&
    typeof link === "object" &&
    !Array.isArray(link) &&
    Object.keys(link).length === 1 &&
    (Object.hasOwn(link, "objectId")
      ? identifier(link.objectId)
      : Object.hasOwn(link, "url") && !!textLinkURL(link.url))
  );
}
export function objectAddress(board, objectId, base) {
  if (
    (objectId !== undefined && !identifier(objectId)) ||
    !identifier(board.id)
  )
    return null;
  const url = new URL(base);
  if (!["https:", "http:"].includes(url.protocol)) return null;
  url.search = "";
  url.username = url.password = "";
  url.hash = new URLSearchParams(
    board.shared
      ? {
          server: workerURL(board.shared.server),
          board: board.shared.room,
          ...(objectId ? { object: objectId } : {}),
        }
      : { local: board.id, ...(objectId ? { object: objectId } : {}) },
  ).toString();
  return url.href;
}
export function boardDestination(value, base) {
  try {
    const url = new URL(value, base),
      app = new URL(base);
    if (
      !textLinkURL(url.href) ||
      url.username ||
      url.password ||
      url.origin !== app.origin ||
      url.pathname !== app.pathname
    )
      return null;
    const p = new URLSearchParams(url.hash.slice(1)),
      objectId = p.get("object") || undefined,
      // A notification about a comment names its discussion, which opens
      // with the board; an address without one is unchanged.
      thread = p.get("thread") || undefined;
    if (objectId !== undefined && !identifier(objectId)) return null;
    if (thread !== undefined && !identifier(thread)) return null;
    if (p.has("local") && !p.has("board") && identifier(p.get("local")))
      return { localId: p.get("local"), objectId };
    if (p.has("board") && !p.has("local") && ID.test(p.get("board")))
      return {
        server: workerURL(p.get("server")),
        room: p.get("board"),
        token: p.get("invite") || undefined,
        objectId,
        ...(thread ? { thread } : {}),
      };
  } catch {}
  return null;
}
export function linkTo(value, board, base) {
  const url = textLinkURL(value, true);
  if (!url) return null;
  const target = boardDestination(url, base);
  if (
    target?.objectId &&
    (target.localId === board.id ||
      (board.shared &&
        target.server === board.shared.server &&
        target.room === board.shared.room))
  )
    return { objectId: target.objectId };
  return { url };
}
export function remapObjectLink(item, ids) {
  const id = item.objectLink?.objectId;
  if (ids.has(id)) item.objectLink = { objectId: ids.get(id) };
}
export function externalizeObjectLinks(items, address) {
  if (!address) return items;
  const kept = new Set(items.map((i) => i.id));
  for (const item of items) {
    const id = item.objectLink?.objectId;
    if (id && !kept.has(id)) {
      const url = address(id);
      if (url) item.objectLink = { url };
    }
  }
  return items;
}
