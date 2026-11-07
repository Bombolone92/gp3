import { bounds, clone, item, uid, validateBoard } from "./model.js";
import { assertUnlocked } from "./locking.js";
import { inferParents, updateConnectors } from "./scene.js";
import { growsWithText, textStyle } from "./text.js";
import { newTask } from "./planning/task.js";

export const QUICK_DIRECTIONS = ["top", "right", "bottom", "left"];
export const canQuickConnect = (i) =>
  i && !i.mindMap && ["rect", "ellipse", "note", "text"].includes(i.type);
const directions = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

// Bounded scans and interval sorting, never collision-pair enumeration.
// Connections and containing frames do not occupy space for a new node.
// Objects in `skip`, hidden from this person, are neither connected to nor
// avoided, so nothing shows where they are.
export function quickConnectPlan(items, id, direction, skip = null) {
  const source = items.find((i) => i.id === id);
  if (!canQuickConnect(source) || !QUICK_DIRECTIONS.includes(direction))
    throw Error("Select one shape, sticky note, or text box.");
  assertUnlocked(items, new Set([id]));
  const sourceBox = bounds([source]);
  const [dx, dy] = directions[direction],
    horizontal = !!dx,
    sign = dx || dy;
  const along = horizontal ? "x" : "y",
    across = horizontal ? "y" : "x";
  const length = horizontal ? "w" : "h",
    breadth = horizontal ? "h" : "w";
  const edge = sourceBox[along] + (sign > 0 ? sourceBox[length] : 0);
  const middle = sourceBox[across] + sourceBox[breadth] / 2;
  const boxes = items
    .filter(
      (i) =>
        i.id !== id && !["arrow", "frame"].includes(i.type) && !skip?.has(i.id),
    )
    .map((i) => {
      const box = bounds([i]);
      return {
        i,
        box,
        near: sign > 0 ? box[along] - edge : edge - box[along] - box[length],
        far: sign > 0 ? box[along] + box[length] - edge : edge - box[along],
      };
    });
  const candidates = boxes
    .filter(
      ({ i, box, near }) =>
        i.type !== "pen" &&
        near >= 0 &&
        near <= Math.max(160, Math.min(400, sourceBox[length])) &&
        Math.abs(box[across] + box[breadth] / 2 - middle) <=
          Math.max(12, Math.min(sourceBox[breadth], box[breadth]) * 0.25),
    )
    .sort((a, b) => a.near - b.near || a.i.id.localeCompare(b.i.id));
  // An intervening object in the center lane blocks a suggested connection.
  const candidate = candidates[0];
  const target =
    candidate &&
    !boxes.some(
      ({ i, box, near, far }) =>
        i.id !== candidate.i.id &&
        far > 0 &&
        near < candidate.near &&
        box[across] < middle + 4 &&
        box[across] + box[breadth] > middle - 4,
    )
      ? candidate.i
      : null;
  let node = null;
  if (!target) {
    let distance = 80;
    const intervals = boxes
      .filter(
        ({ box, far }) =>
          far > 0 &&
          box[across] < sourceBox[across] + sourceBox[breadth] + 24 &&
          box[across] + box[breadth] > sourceBox[across] - 24,
      )
      .sort((a, b) => a.near - b.near);
    for (const obstacle of intervals) {
      if (obstacle.far + 24 <= distance) continue;
      if (obstacle.near - 24 >= distance + sourceBox[length]) break;
      distance = obstacle.far + 80;
    }
    node = {
      ...clone(source),
      id: uid(),
      text: "",
      [along]:
        source[along] +
        (sign > 0 ? edge + distance : edge - distance - sourceBox[length]) -
        sourceBox[along],
    };
    if (growsWithText(node)) {
      node.h = Math.ceil(textStyle(node).size * 1.35);
      const box = bounds([node]);
      node[across] += middle - box[across] - box[breadth] / 2;
      node[along] +=
        (sign > 0 ? edge + distance : edge - distance - box[length]) -
        box[along];
    }
    for (const key of [
      "groupId",
      "parentId",
      "locked",
      "textRuns",
      "textBlocks",
      "tagIds",
      "objectLink",
    ])
      delete node[key];
    // The new node takes the source's look, not its content: a task's
    // assignee, dates, and Jira issue stay with the task.
    if (node.task) node.task = newTask();
    inferParents([...items, node], new Set([node.id]), { skip });
  }
  const destination = target || node;
  const existing =
    target &&
    items.find(
      (i) =>
        i.type === "arrow" &&
        ((i.startId === id && i.endId === target.id) ||
          (i.endId === id && i.startId === target.id)),
    );
  const line =
    existing || item("arrow", 0, 0, { startId: id, endId: destination.id });
  if (!existing) updateConnectors([source, destination, line]);
  const added = existing ? [] : node ? [node, line] : [line];
  if (items.length + added.length > 5000)
    throw Error("A board can contain at most 5,000 objects.");
  // Validate the small fragment, including relationships, before any mutation.
  if (!existing)
    validateBoard({
      version: 1,
      id: "quick-connect",
      title: "",
      items: [source, destination, line].map((i) => {
        const c = clone(i);
        delete c.parentId;
        delete c.groupId;
        delete c.tagIds;
        return c;
      }),
    });
  return {
    source,
    target: destination,
    node,
    line,
    added,
    existing: !!existing,
  };
}

export function quickPortPositions(source, view) {
  source = bounds([source]);
  const x = view.x + source.x * view.z,
    y = view.y + source.y * view.z;
  const w = source.w * view.z,
    h = source.h * view.z;
  return {
    top: [x + w / 2, y - 30],
    right: [x + w + 30, y + h / 2],
    bottom: [x + w / 2, y + h + 30],
    left: [x - 30, y + h / 2],
  };
}
