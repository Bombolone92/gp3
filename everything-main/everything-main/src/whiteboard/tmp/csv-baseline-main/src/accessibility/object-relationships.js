import { escape } from "../model.js";
import { t } from "../i18n.js";
import { objectNameHTML } from "./object-content.js";

// Only pass the objects this person may read, with private content masked.
// A relationship must never recover a name from the unfiltered board.
export function objectRelationships(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const groups = new Map();
  const children = new Map();
  for (const i of items) {
    if (i.groupId) {
      if (!groups.has(i.groupId))
        groups.set(i.groupId, { number: groups.size + 1, count: 0 });
      groups.get(i.groupId).count++;
    }
    if (i.parentId)
      children.set(i.parentId, (children.get(i.parentId) || 0) + 1);
  }
  const label = (value) => escape(t(value));
  const count = (n) =>
    `${n} ${label(n === 1 ? "visible object" : "visible objects")}`;
  const name = (id) => {
    const target = byId.get(id);
    return target ? objectNameHTML(target, 120) : label("Hidden object");
  };
  const cap = (value) =>
    label(
      value === "arrow" ? "Arrowhead" : value === "circle" ? "Dot" : "None",
    );
  return new Map(
    items.map((i) => {
      const parts = [];
      if (i.parentId) parts.push(`${label("In frame")}: ${name(i.parentId)}.`);
      if (i.type === "frame" && children.has(i.id))
        parts.push(`${label("Contains")}: ${count(children.get(i.id))}.`);
      if (i.groupId) {
        const group = groups.get(i.groupId);
        parts.push(`${label("Group")} ${group.number}: ${count(group.count)}.`);
      }
      if (i.mindMap?.parent)
        parts.push(`${label("Mind map parent")}: ${name(i.mindMap.parent)}.`);
      if (i.type === "arrow") {
        parts.push(
          `${label("Start object")}: ${i.startId ? name(i.startId) : label("Free endpoint")}.`,
        );
        parts.push(
          `${label("End object")}: ${i.endId ? name(i.endId) : label("Free endpoint")}.`,
        );
        parts.push(
          `${label("Start")}: ${cap(i.startCap || "none")}. ${label("End")}: ${cap(i.endCap || "arrow")}.`,
        );
      }
      return [i.id, parts.join(" ")];
    }),
  );
}
