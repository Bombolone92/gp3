import { hasTask, readTask, statusFromTitle } from "./task.js";

// Kanban status sync: frames titled after a status ("To do", "In progress",
// "Blocked", "Done", or French equivalents) act as board columns.
export const statusSyncEnabled = (board) => !!board?.planning?.statusSync;

export function taskParents(items) {
  return new Map(items.filter(hasTask).map((i) => [i.id, i.parentId || null]));
}

// Tasks that entered a status frame since `before` and would change status.
export function statusSyncChanges(before, items) {
  const frames = new Map(
    items.filter((i) => i.type === "frame").map((f) => [f.id, f]),
  );
  const changes = [];
  for (const i of items) {
    if (!hasTask(i) || !before.has(i.id)) continue;
    const parent = i.parentId || null;
    if (parent === before.get(i.id) || !parent) continue;
    const status = statusFromTitle(frames.get(parent)?.text || "");
    if (status && readTask(i).status !== status)
      changes.push({ item: i, status });
  }
  return changes;
}

export function applyStatusSync(board, before) {
  if (!statusSyncEnabled(board) || !before?.size) return [];
  const changes = statusSyncChanges(before, board.items);
  for (const { item, status } of changes) item.task = { ...item.task, status };
  return changes;
}
