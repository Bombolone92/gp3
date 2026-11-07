import { taskRow } from "./planning/task.js";
export const TAG_LIMIT = 8;
export const TAG_COLORS = [
  "#c43b3b",
  "#56822a",
  "#137f91",
  "#916c00",
  "#b93483",
  "#27834b",
  "#365dc4",
  "#667069",
  "#7951b0",
  "#185c49",
  "#284b77",
  "#414843",
  "#222722",
];
export const tagKey = (name) =>
  name.normalize("NFKC").trim().toLocaleLowerCase("en");
export const validTagId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export function validateTags(tags) {
  if (tags === undefined) return;
  if (!Array.isArray(tags) || tags.length > 1000)
    throw Error("A board can contain up to 1,000 tags.");
  const ids = new Set();
  for (const tag of tags) {
    if (
      !tag ||
      !validTagId(tag.id) ||
      ids.has(tag.id) ||
      typeof tag.name !== "string" ||
      !tag.name.trim() ||
      tag.name !== tag.name.trim() ||
      tag.name.length > 64 ||
      /[\r\n\t]/.test(tag.name) ||
      !/^#[\da-f]{6}$/i.test(tag.color) ||
      Object.keys(tag).some((k) => !["id", "name", "color"].includes(k))
    )
      throw Error("Invalid board tag.");
    ids.add(tag.id);
  }
}
export function validateTagIds(item, known) {
  if (item.tagIds === undefined) return;
  if (
    !Array.isArray(item.tagIds) ||
    item.tagIds.length > TAG_LIMIT ||
    new Set(item.tagIds).size !== item.tagIds.length ||
    item.tagIds.some((id) => !validTagId(id) || !known.has(id))
  )
    throw Error("Invalid object tags.");
}
export function referencedTags(items, tags = []) {
  const ids = new Set(items.flatMap((i) => i.tagIds || []));
  return tags.filter((t) => ids.has(t.id));
}
export function importTags(board, items, incoming = []) {
  const tags = structuredClone(board.tags || []),
    map = new Map();
  for (const tag of incoming) {
    const same = tags.find((t) => tagKey(t.name) === tagKey(tag.name));
    if (same) map.set(tag.id, same.id);
    else {
      const copy = { ...tag };
      if (tags.some((t) => t.id === copy.id)) copy.id = crypto.randomUUID();
      tags.push(copy);
      map.set(tag.id, copy.id);
    }
  }
  validateTags(tags);
  const known = new Set(tags.map((t) => t.id));
  for (const i of items) {
    if (i.tagIds)
      i.tagIds = [...new Set(i.tagIds.map((id) => map.get(id) || id))];
    validateTagIds(i, known);
  }
  return tags;
}
export function rebaseTags(local = [], before = [], remote = []) {
  const old = new Map(before.map((t) => [t.id, t])),
    mine = new Map(local.map((t) => [t.id, t]));
  const result = remote
    .filter((t) => !old.has(t.id) || mine.has(t.id))
    .map((t) =>
      old.has(t.id) &&
      mine.has(t.id) &&
      JSON.stringify(mine.get(t.id)) !== JSON.stringify(old.get(t.id))
        ? structuredClone(mine.get(t.id))
        : structuredClone(t),
    );
  for (const t of local)
    if (!old.has(t.id) && !result.some((r) => r.id === t.id))
      result.push(structuredClone(t));
  return result;
}
export function rebaseTagIds(local = [], before = [], remote = []) {
  const old = new Set(before),
    mine = new Set(local);
  return [
    ...new Set([
      ...remote.filter((id) => !old.has(id) || mine.has(id)),
      ...local.filter((id) => !old.has(id)),
    ]),
  ]
    .sort()
    .slice(0, TAG_LIMIT);
}
// Tagged sticky notes reserve one compact footer row, inside their bounds.
// Task objects add a status row below it (see planning/task.js).
export const tagRow = (i) =>
  i.type === "note" && i.tagIds?.length ? Math.min(30, Math.abs(i.h) * 0.3) : 0;
export const tagFooter = (i) => tagRow(i) + taskRow(i);
