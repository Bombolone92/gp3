import { descendants, completeGroups } from "./scene.js";

const types = [
  ["note", "Sticky notes"],
  ["text", "Text"],
  ["shape", "Shapes"],
  ["arrow", "Connection lines"],
  ["pen", "Drawings"],
  ["image", "Images"],
  ["frame", "Frames"],
  ["table", "Tables"],
  ["link", "Links"],
  ["file", "Attachments"],
  ["embed", "Embeds"],
  ["mind", "Mind map nodes"],
  ["group", "Groups"],
];

// Groups are atomic in selection/movement. Classify them separately so choosing
// stickies never also moves an unrelated shape that shares their group.
export function selectionFilters(items, selection, options) {
  const buckets = new Map(),
    groups = new Set(),
    wholeGroups =
      options?.groups === false ? completeGroups(items, selection) : null;
  for (const i of items) {
    if (!selection.has(i.id)) continue;
    const grouped =
      i.groupId &&
      i.groupId !== options?.withinGroup &&
      (!wholeGroups || wholeGroups.has(i.groupId));
    const key = grouped
      ? "group"
      : i.mindMap
        ? "mind"
        : ["rect", "ellipse"].includes(i.type)
          ? "shape"
          : i.type;
    if (!buckets.has(key)) buckets.set(key, { seeds: new Set(), count: 0 });
    const bucket = buckets.get(key);
    bucket.seeds.add(i.id);
    if (!grouped || !groups.has(i.groupId)) bucket.count++;
    if (grouped) groups.add(i.groupId);
  }
  const choices = types.flatMap(([key, label]) => {
    const bucket = buckets.get(key);
    return bucket
      ? [
          {
            key,
            label,
            ...bucket,
            ids: descendants(items, bucket.seeds, options),
          },
        ]
      : [];
  });
  // Only selection metadata participates. Text, geometry, and styles can change
  // while the dialog is open without invalidating an otherwise identical choice.
  const signature = JSON.stringify(
    choices.map(({ key, seeds, ids, count }) => [
      key,
      count,
      [...seeds].sort(),
      [...ids].sort(),
    ]),
  );
  return { choices, signature };
}
