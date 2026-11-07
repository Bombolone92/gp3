import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import { applyMindLayout } from "../src/mind-map.js";
import {
  createMindDrag,
  validMindDrag,
  mindDragCandidate,
  planMindReparent,
} from "../src/mind-map-drag.js";

test("mind branch reassignment plans descendants and both automatic maps atomically", () => {
  const b = board("Map", "mindmap"),
    [root, child, sibling] = b.items;
  const nested = item("rect", 0, 0, {
    text: "Nested",
    mindMap: { ...child.mindMap, parent: child.id },
  });
  const other = item("rect", -400, 200, {
    text: "Other map",
    mindMap: { ...root.mindMap, direction: "down" },
  });
  b.items.push(nested, other);
  applyMindLayout(b.items, root.id);
  const before = structuredClone(b);
  const plan = planMindReparent(b, child.id, other.id, "left");
  assert.deepEqual(b, before);
  const moved = plan.items.find((i) => i.id === child.id),
    below = plan.items.find((i) => i.id === nested.id);
  assert.equal(moved.mindMap.parent, other.id);
  assert.equal(below.mindMap.parent, child.id);
  assert.equal(below.mindMap.direction, "left");
  assert.ok(moved.x + moved.w < other.x);
  assert.ok(below.x + below.w < moved.x);
  assert.equal(plan.items.find((i) => i.id === root.id).mindMap.auto, true);
  assert.equal(plan.items.find((i) => i.id === other.id).mindMap.auto, true);
  validateBoard({ ...b, items: plan.items });
  assert.throws(
    () => planMindReparent(b, child.id, nested.id),
    /inside itself/,
  );
  sibling.locked = true;
  assert.throws(() => planMindReparent(b, child.id, other.id), /Unlock/);
  assert.equal(b.items.find((i) => i.id === child.id).mindMap.parent, root.id);
});

test("manual destination retains dragged geometry and nested destinations inherit their branch direction", () => {
  const b = board("Manual", "mindmap"),
    [root, child, target] = b.items;
  root.mindMap.auto = false;
  target.mindMap.direction = "up";
  child.x = 712;
  child.y = 91;
  const plan = planMindReparent(b, child.id, target.id, "left");
  const result = plan.items.find((i) => i.id === child.id);
  assert.equal(result.x, 712);
  assert.equal(result.y, 91);
  assert.equal(result.mindMap.direction, "up");
  assert.equal(plan.items[0].mindMap.auto, false);
  assert.equal(planMindReparent(b, child.id, root.id).patch.length, 0);
  target.locked = true;
  assert.throws(() => planMindReparent(b, child.id, target.id), /Unlock/);
});

test("mind drag guards detect changed hierarchy, groups and remote geometry while allowing local movement and text", () => {
  const b = board("Map", "mindmap"),
    [root, child] = b.items;
  const gesture = createMindDrag(b.items, child.id, new Set([child.id]));
  assert.ok(gesture);
  assert.equal(
    createMindDrag(b.items, child.id, new Set([child.id, root.id])),
    null,
  );
  child.text = "Remote text";
  child.x += 20;
  assert.equal(validMindDrag(b.items, gesture), true);
  assert.equal(validMindDrag(b.items, gesture, true), false);
  child.groupId = "Changed group";
  assert.equal(validMindDrag(b.items, gesture), false);
  delete child.groupId;
  b.items.push(
    item("rect", 0, 0, { mindMap: { ...child.mindMap, parent: child.id } }),
  );
  assert.equal(validMindDrag(b.items, gesture), false);
});

test("mind drag targeting respects occlusion, branch exclusion, root sides and bounded text-free scans", () => {
  const b = board("Map", "mindmap"),
    [root, child, target] = b.items;
  root.x = -10000;
  target.x = 100;
  target.y = 100;
  target.w = 200;
  target.h = 80;
  const gesture = createMindDrag(b.items, child.id, new Set([child.id]));
  for (let n = 0; n < 4996; n++) {
    const node = item("note", -10000, -10000);
    Object.defineProperty(node, "text", {
      get() {
        throw Error("Unrelated text read");
      },
    });
    b.items.push(node);
  }
  assert.deepEqual(mindDragCandidate(b.items, gesture, { x: 200, y: 140 }, 1), {
    id: target.id,
    direction: "right",
  });
  target.mindMap.parent = null;
  assert.deepEqual(
    mindDragCandidate(b.items, gesture, { x: 120, y: 140 }, 0.15),
    { id: target.id, direction: "left" },
  );
  assert.ok(
    planMindReparent(b, child.id, target.id, "left", { validate: false }).patch
      .length,
    "Hover planning does not scan unrelated text or encoded image data",
  );
  b.items.push(item("rect", 100, 100, { w: 200, h: 80 }));
  assert.equal(
    mindDragCandidate(b.items, gesture, { x: 200, y: 140 }, 3),
    null,
  );
});
