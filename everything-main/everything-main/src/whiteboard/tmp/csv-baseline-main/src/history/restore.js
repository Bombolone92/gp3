import { clone } from "../model.js";
import { addTranslations } from "../i18n.js";
import { repairMindTrees } from "../mind-map.js";

// Granular restoration from an earlier version of a board. Each function
// returns new items; the editor saves them as an ordinary, undoable change,
// so restoring never destroys the history it restores from.
const byId = (items) => new Map(items.map((i) => [i.id, i]));
// Whether two objects hold the same data. Shared versions list an object's
// fields in a different order than the copy being edited, so the order of
// keys does not count.
export function sameObject(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a).filter((k) => a[k] !== undefined);
  return (
    keys.length === Object.keys(b).filter((k) => b[k] !== undefined).length &&
    keys.every((k) => sameObject(a[k], b[k]))
  );
}

// Connectors come back when both of their attached ends exist and either the
// connector or one of its ends is being restored.
function withConnectors(result, version, restored) {
  const present = new Set(result.map((i) => i.id));
  for (const i of version.items)
    if (
      i.type === "arrow" &&
      !present.has(i.id) &&
      (i.startId || i.endId) &&
      (!i.startId || restored.has(i.startId) || present.has(i.startId)) &&
      (!i.endId || restored.has(i.endId) || present.has(i.endId)) &&
      (restored.has(i.id) || restored.has(i.startId) || restored.has(i.endId))
    ) {
      result.push(clone(i));
      present.add(i.id);
    }
  return result;
}
// Drop references the restored scene cannot keep: missing objects, frames
// that are no longer frames, deleted tags, and mind map parents that are
// gone or would form a cycle. Objects are copied before they change, so the
// current board is never modified in place.
function repair(items, tags = [], restored = new Set()) {
  const ids = byId(items),
    known = new Set(tags.map((t) => t.id));
  const out = items.map((i) => {
    let copy = null;
    const edit = () => (copy ??= clone(i));
    if (i.parentId && ids.get(i.parentId)?.type !== "frame")
      delete edit().parentId;
    if (i.startId && !ids.has(i.startId)) delete edit().startId;
    if (i.endId && !ids.has(i.endId)) delete edit().endId;
    if (i.mindMap?.parent && !ids.get(i.mindMap.parent)?.mindMap)
      edit().mindMap = { ...i.mindMap, parent: null };
    if (i.tagIds?.some((id) => !known.has(id))) {
      const kept = i.tagIds.filter((id) => known.has(id));
      if (kept.length) edit().tagIds = kept;
      else delete edit().tagIds;
    }
    return copy || i;
  });
  // A restored parent that would close a loop is dropped from the restored
  // object itself, so objects that were not restored keep their place.
  const minds = new Map(out.filter((i) => i.mindMap).map((i) => [i.id, i]));
  out.forEach((i, n) => {
    if (!restored.has(i.id) || !i.mindMap?.parent) return;
    let p = minds.get(i.mindMap.parent);
    for (let steps = 0; p && p !== i && steps < minds.size; steps++)
      p = minds.get(p.mindMap.parent);
    if (p !== i) return;
    out[n] = { ...i, mindMap: { ...i.mindMap, parent: null } };
    minds.set(i.id, out[n]);
  });
  // Break any other mind map cycle on shallow copies, keeping changed ones.
  const nodes = out.map((i) => (i.mindMap ? { ...i } : i));
  repairMindTrees(nodes);
  return nodes.map((node, n) =>
    node.mindMap !== out[n].mindMap ? node : out[n],
  );
}
// Objects that come back take their place in the version's stacking order:
// each goes below every object that was above it then and is still on the
// board, instead of on top of everything. `before` holds the ids on the
// board before the restore.
function restack(items, version, before) {
  const back = new Map(
    items.filter((i) => !before.has(i.id)).map((i) => [i.id, i]),
  );
  if (!back.size) return items;
  const position = new Map(
    items.filter((i) => !back.has(i.id)).map((i, n) => [i.id, n]),
  );
  // From the top of the version down, the lowest place now held by an
  // object that was above.
  const below = new Map(),
    top = [];
  let lowest = Infinity;
  for (let n = version.items.length - 1; n >= 0; n--) {
    const { id } = version.items[n];
    if (position.has(id)) lowest = Math.min(lowest, position.get(id));
    else if (back.has(id)) {
      const group = lowest === Infinity ? top : below.get(lowest) || [];
      if (lowest !== Infinity) below.set(lowest, group);
      group.unshift(back.get(id));
    }
  }
  const placed = new Set([...below.values(), top].flat().map((i) => i.id));
  const out = [];
  for (const i of items) {
    if (back.has(i.id)) {
      // Anything the version did not hold keeps its place.
      if (!placed.has(i.id)) out.push(i);
      continue;
    }
    out.push(...(below.get(position.get(i.id)) || []), i);
  }
  return out.concat(top);
}
// Replace the chosen objects with their earlier state, re-adding any that
// were deleted since. Objects that did not exist then are left alone.
export function restoreObjects(current, version, ids) {
  const old = byId(version.items),
    restored = new Set([...ids].filter((id) => old.has(id)));
  const result = current.items.map((i) =>
    restored.has(i.id) ? clone(old.get(i.id)) : i,
  );
  const present = new Set(result.map((i) => i.id));
  for (const id of restored)
    if (!present.has(id)) result.push(clone(old.get(id)));
  return {
    items: restack(
      repair(withConnectors(result, version, restored), current.tags, restored),
      version,
      byId(current.items),
    ),
    count: restored.size,
  };
}
// Every existing object restoring a frame would change or remove: what the
// frame holds now and held then, and connectors attached to them.
export function frameRestoreIds(current, version, frameId, keep) {
  const after = new Map(
    restoreFrame(current, version, frameId, keep).items.map((i) => [i.id, i]),
  );
  return new Set(
    current.items
      .filter((i) => !after.has(i.id) || !sameObject(after.get(i.id), i))
      .map((i) => i.id),
  );
}
// Make a frame and its contents match the earlier version exactly. Objects
// in `keep`, such as ones hidden from the person restoring, are left as
// they are.
export function restoreFrame(current, version, frameId, keep = new Set()) {
  const old = byId(version.items);
  if (old.get(frameId)?.type !== "frame")
    throw Error("That frame is not in this version.");
  const then = new Set(
    version.items
      .filter((i) => i.id === frameId || i.parentId === frameId)
      .map((i) => i.id),
  );
  const now = new Set(
    current.items
      .filter(
        (i) => (i.id === frameId || i.parentId === frameId) && !keep.has(i.id),
      )
      .map((i) => i.id),
  );
  // Objects moved into the frame since go back to where the version had
  // them; only objects the version lacks are removed from the frame.
  const restored = new Set(then);
  for (const id of now) if (old.has(id)) restored.add(id);
  const kept = current.items.filter(
    (i) => !now.has(i.id) || restored.has(i.id),
  );
  const result = kept.map((i) =>
    restored.has(i.id) ? clone(old.get(i.id)) : i,
  );
  const present = new Set(result.map((i) => i.id));
  for (const id of then) if (!present.has(id)) result.push(clone(old.get(id)));
  return {
    items: restack(
      repair(withConnectors(result, version, restored), current.tags, restored),
      version,
      byId(current.items),
    ),
    count: restored.size,
  };
}
// A copy of a whole version without the given objects, such as ones hidden
// from the person restoring that have since been deleted. Connectors, frame
// members, mind map children, and tags that pointed at them are repaired so
// the rest of the version can still be restored.
export function withoutObjects(version, ids) {
  const copy = clone(version);
  copy.items = repair(
    copy.items.filter((i) => !ids.has(i.id)),
    copy.tags,
  );
  return copy;
}
// A whole version, except that objects in `keep` stay exactly as they are
// on the board now, in the same place among their neighbours, and those it
// no longer has are not brought back. The workshop hides such objects from
// the person restoring, who can neither see nor change them.
export function restoreBoard(current, version, keep = new Set()) {
  const now = byId(current.items);
  const copy = withoutObjects(
    version,
    new Set([...keep].filter((id) => !now.has(id))),
  );
  const kept = new Set([...keep].filter((id) => now.has(id)));
  if (!kept.size) return copy;
  // Each kept object goes after the object below it now, when that one is
  // still there, so the stacking order around it does not change.
  const restored = new Set(copy.items.map((i) => i.id)),
    after = new Map(),
    lowest = [];
  let anchor = null;
  for (const i of current.items)
    if (kept.has(i.id)) {
      const group = anchor ? after.get(anchor) || [] : lowest;
      if (anchor) after.set(anchor, group);
      group.push(clone(i));
    } else if (restored.has(i.id)) anchor = i.id;
  const items = [...lowest];
  for (const i of copy.items)
    if (!kept.has(i.id)) items.push(i, ...(after.get(i.id) || []));
  // Tags the kept objects use stay available.
  const tags = [...(copy.tags || [])],
    known = new Set(tags.map((t) => t.id)),
    used = new Set(
      current.items.flatMap((i) => (kept.has(i.id) && i.tagIds) || []),
    );
  for (const tag of current.tags || [])
    if (!known.has(tag.id) && used.has(tag.id)) tags.push(clone(tag));
  if (tags.length) copy.tags = tags;
  copy.items = repair(items, tags);
  return copy;
}
// Objects that existed in the version but have since been deleted.
export function deletedSince(current, version) {
  const present = new Set(current.items.map((i) => i.id));
  return version.items.filter((i) => !present.has(i.id));
}
export function recoverDeleted(current, version) {
  const missing = deletedSince(current, version);
  const restored = new Set(missing.map((i) => i.id));
  const result = [
    ...current.items,
    ...missing
      .filter((i) => i.type !== "arrow" || (!i.startId && !i.endId))
      .map(clone),
  ];
  const items = restack(
    repair(withConnectors(result, version, restored), current.tags, restored),
    version,
    byId(current.items),
  );
  return { items, count: items.length - current.items.length };
}

addTranslations({
  "Everyone's edits to this shared board are kept, so any earlier version can be restored. Restoring saves a new version and never removes history.":
    "Les modifications de tous les participants à ce tableau partagé sont conservées; toute version antérieure peut donc être restaurée. La restauration enregistre une nouvelle version et ne supprime jamais l’historique.",
  "Shared board history": "Historique du tableau partagé",
  "Show older versions": "Afficher les versions plus anciennes",
  "Versions on this device": "Versions sur cet appareil",
  "Restore options": "Options de restauration",
  "Restore selected objects": "Restaurer les objets sélectionnés",
  "Recover deleted objects": "Récupérer les objets supprimés",
  "Open as a copy": "Ouvrir une copie",
  Frame: "Cadre",
  "Untitled frame": "Cadre sans titre",
  "Restore this frame": "Restaurer ce cadre",
  "{count} object restored.": "{count} objet restauré.",
  "{count} objects restored.": "{count} objets restaurés.",
  "Could not restore this version.": "Impossible de restaurer cette version.",
  "Could not load this version.": "Impossible de charger cette version.",
  edit: "modification",
  edits: "modifications",
  "Current version": "Version actuelle",
  "More options": "Plus d’options",
  "No shared edits yet.": "Aucune modification partagée pour le moment.",
  "Could not load the shared history.":
    "Impossible de charger l’historique partagé.",
  "That frame is no longer shown to you.": "Ce cadre ne vous est plus affiché.",
  "That frame is not in this version.":
    "Ce cadre ne figure pas dans cette version.",
});
