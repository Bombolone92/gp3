import { assertUnlocked } from "./locking.js";

// Mind-map nodes and link/file cards have their own content and layout rules.
export const canClearContent = (i) =>
  !!i && ["note", "rect", "ellipse"].includes(i.type) && !i.mindMap;
export const hasClearableContent = (i) =>
  canClearContent(i) &&
  !!(i.text || i.tagIds?.length || i.textRuns?.length || i.textBlocks?.length);

// Consume resolved selection ids: a member selected inside a group stays local.
// Remove assignments, never the board's tag catalog, object links or comments.
export function clearContent(items, ids) {
  assertUnlocked(items, ids);
  let count = 0;
  for (const i of items) {
    if (!ids.has(i.id) || !hasClearableContent(i)) continue;
    i.text = "";
    delete i.tagIds;
    delete i.textRuns;
    delete i.textBlocks;
    count++;
  }
  return count;
}
