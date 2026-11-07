import { validTagId, TAG_LIMIT } from "../tags.js";
export const sharedTagKey = (key) =>
  key.startsWith("tag:") && validTagId(key.slice(4));
export function changeTagIds(entry, ids = []) {
  const wanted = new Set(ids);
  for (const key of entry.keys())
    if (sharedTagKey(key) && !wanted.has(key.slice(4))) entry.delete(key);
  for (const id of ids)
    if (!entry.has(`tag:${id}`)) entry.set(`tag:${id}`, true);
}
export function readTagIds(entry, catalog) {
  return [...entry.keys()]
    .filter(sharedTagKey)
    .map((key) => key.slice(4))
    .filter((id) => catalog.has(id))
    .sort()
    .slice(0, TAG_LIMIT);
}
