import test from "node:test";
import assert from "node:assert/strict";
import { item, board, validateBoard } from "../src/model.js";
import {
  quickConnectPlan,
  quickPortPositions,
  QUICK_DIRECTIONS,
} from "../src/quick-connect.js";
import { moveItems } from "../src/scene.js";
import { SharedDocument } from "../src/collaboration/document.js";

test("quick creation preserves styling, leaves the source alone, and connects in four directions", () => {
  for (const type of ["note", "rect", "ellipse", "text"])
    for (const direction of QUICK_DIRECTIONS) {
      const source = item(type, -300, -200, {
        text: "Original",
        color: "#dce5f7",
        bold: true,
        textAlign: "right",
        fontSize: 27,
        groupId: "old-group",
        ...(type === "rect" ? { shape: "diamond" } : {}),
      });
      const before = structuredClone(source),
        plan = quickConnectPlan([source], source.id, direction);
      assert.deepEqual(source, before);
      assert.equal(plan.added.length, 2);
      assert.equal(plan.node.text, "");
      assert.equal(plan.node.type, type);
      assert.equal(plan.node.bold, true);
      assert.equal(plan.node.textAlign, "right");
      assert.equal(plan.node.color, source.color);
      assert.equal(plan.node.fontSize, 27);
      assert.equal(plan.node.shape, source.shape);
      assert.equal(plan.node.groupId, undefined);
      assert.notEqual(plan.node.id, source.id);
      if (direction === "right")
        assert.equal(plan.node.x, source.x + source.w + 80);
      if (direction === "left")
        assert.equal(plan.node.x + plan.node.w, source.x - 80);
      if (direction === "bottom")
        assert.equal(plan.node.y, source.y + source.h + 80);
      if (direction === "top")
        assert.equal(plan.node.y + plan.node.h, source.y - 80);
      assert.equal(plan.line.startId, source.id);
      assert.equal(plan.line.endId, plan.node.id);
      validateBoard({ ...board(), items: [source, ...plan.added] });
    }
});

test("quick connections choose nearby aligned objects and reuse existing lines", () => {
  const a = item("rect", 0, 0, { w: 100, h: 100 }),
    near = item("ellipse", 200, 0, { w: 100, h: 100, locked: true }),
    far = item("note", 250, 0, { w: 100, h: 100 });
  const plan = quickConnectPlan([a, far, near], a.id, "right");
  assert.equal(plan.target, near);
  assert.equal(plan.node, null);
  assert.equal(plan.added.length, 1);
  assert.equal(
    quickConnectPlan([a, near, plan.line], a.id, "right").existing,
    true,
  );
  delete near.locked;
  assert.equal(
    quickConnectPlan([a, near, plan.line], near.id, "left").added.length,
    0,
  );
});

test("placement skips occupied boxes and assigns the containing frame without cloning membership", () => {
  const frame = item("frame", -500, -500, { w: 1500, h: 1000 });
  const source = item("rect", 0, 0, { w: 100, h: 100, parentId: frame.id });
  const obstacle = item("note", 140, 70, { w: 200, h: 100, locked: true });
  const second = item("ellipse", 420, 70, { w: 100, h: 100 });
  const plan = quickConnectPlan(
    [frame, source, obstacle, second],
    source.id,
    "right",
  );
  assert.equal(plan.node.x, 600);
  assert.equal(plan.node.parentId, frame.id);
  const out = quickConnectPlan(
    [frame, source, item("rect", 140, -70, { w: 900, h: 100 })],
    source.id,
    "right",
  );
  assert.equal(out.node.parentId, undefined);
  const blocker = item("pen", 130, 20, {
    w: 10,
    h: 60,
    points: [
      [0, 0],
      [10, 60],
    ],
  });
  const target = item("ellipse", 180, 0, { w: 100, h: 100 });
  const blocked = quickConnectPlan(
    [source, blocker, target],
    source.id,
    "right",
  );
  assert.ok(blocked.node);
  assert.ok(blocked.node.x >= target.x + target.w + 24);
});

test("quick creation handles capacity, protected groups, invalid directions and coordinate limits atomically", () => {
  const source = item("rect", 0, 0);
  const crowded = [
    source,
    ...Array.from({ length: 4998 }, (_, n) => item("note", 1000 + n * 5, 1000)),
  ];
  assert.throws(() => quickConnectPlan(crowded, source.id, "right"), /5,000/);
  assert.equal(crowded.length, 4999);
  assert.throws(
    () => quickConnectPlan([{ ...source, locked: true }], source.id, "right"),
    /Unlock/,
  );
  assert.throws(
    () =>
      quickConnectPlan(
        [
          { ...source, groupId: "g" },
          item("note", 500, 0, { groupId: "g", locked: true }),
        ],
        source.id,
        "right",
      ),
    /Unlock/,
  );
  assert.throws(
    () => quickConnectPlan([source], source.id, "__proto__"),
    /Select one/,
  );
  assert.throws(
    () => quickConnectPlan([{ ...source, x: 999999 }], source.id, "right"),
    /invalid object/,
  );
});

test("quick-connected nodes survive shared serialization and follow moved endpoints", () => {
  const source = item("rect", 0, 0, { shape: "cylinder" });
  const plan = quickConnectPlan([source], source.id, "right");
  const items = [source, ...plan.added];
  const before = structuredClone(plan.line);
  moveItems(items, new Set([plan.node.id]), 100, 100);
  assert.notEqual(plan.line.h, before.h);
  const shared = new SharedDocument();
  shared.commit({ ...board(), items });
  const remote = new SharedDocument(shared.update());
  try {
    remote.validate();
    assert.deepEqual(remote.snapshot().items, items);
  } finally {
    shared.destroy();
    remote.destroy();
  }
  for (const z of [0.15, 1, 3]) {
    const view = { x: -50, y: 100, z },
      positions = quickPortPositions(source, view);
    assert.equal(positions.right[0] - (view.x + (source.x + source.w) * z), 30);
    assert.equal(view.y + source.y * z - positions.top[1], 30);
  }
});

test("placement across a 5,000-object lane finishes without rescanning collision pairs", () => {
  const source = item("note", 0, 0, { w: 100, h: 100 });
  let reads = 0;
  const items = [
    source,
    ...Array.from({ length: 4996 }, (_, n) =>
      Object.defineProperty(item("note", 0, 80, { w: 100, h: 100 }), "x", {
        enumerable: true,
        get() {
          reads++;
          return 180 + n * 150;
        },
      }),
    ),
  ];
  const plan = quickConnectPlan(items, source.id, "right");
  assert.equal(plan.node.x, items.at(-1).x + 180);
  assert.ok(
    reads < items.length * 30,
    "A large lane should not trigger quadratic scans",
  );
});

test("quick connect neither links to nor makes room for objects hidden from this person", () => {
  const source = item("rect", 0, 0, { w: 200, h: 100 }),
    hidden = item("note", 300, 0, { w: 200, h: 100, text: "Secret" });
  const plan = quickConnectPlan(
    [source, hidden],
    source.id,
    "right",
    new Set([hidden.id]),
  );
  assert.ok(plan.node, "a new node is made rather than linking the hidden one");
  assert.notEqual(plan.target.id, hidden.id);
  assert.equal(plan.node.x, 280, "placed as if nothing were there");
  const shown = quickConnectPlan([source, hidden], source.id, "right");
  assert.equal(shown.target.id, hidden.id);
});

test("a quick connect node takes the source's look, not its task or links", () => {
  const source = item("note", 0, 0, {
    text: "Ship it",
    color: "#dce5f7",
    task: {
      assignee: { id: "someone", name: "Someone" },
      start: null,
      due: null,
      status: "in-progress",
      jira: {
        key: "APP-12",
        url: "https://example.atlassian.net/browse/APP-12",
      },
    },
    objectLink: { url: "https://example.com/spec" },
  });
  const { node } = quickConnectPlan([source], source.id, "right");
  assert.equal(node.color, "#dce5f7");
  assert.deepEqual(node.task, {
    assignee: null,
    start: null,
    due: null,
    status: "todo",
  });
  assert.equal(node.objectLink, undefined);
  assert.equal(source.task.jira.key, "APP-12", "the source keeps its task");
});
