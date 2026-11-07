import test from "node:test";
import assert from "node:assert/strict";
import { board, item, bounds, validateBoard } from "../src/model.js";
import { updateConnectors } from "../src/scene.js";
import {
  duplicateSourceIds,
  planDuplication,
  placeDuplicates,
} from "../src/duplication.js";
import { commandEntries } from "../src/commands.js";

test("directional duplication uses the full selection bounds and keeps mixed content independent", () => {
  const source = [
    item("note", -200, -80, {
      text: "A linked idea",
      fontFamily: "caveat",
      locked: true,
      textRuns: [
        {
          start: 2,
          end: 8,
          style: { bold: true, link: "https://example.com/" },
        },
      ],
      textBlocks: [{ start: 0, list: "bullet", indent: 0 }],
    }),
    item("arrow", 200, 130, { w: -90, h: -160 }),
    item("pen", -80, 50, {
      w: 40,
      h: 90,
      points: [
        [0, 0],
        [40, 90],
      ],
    }),
    item("table", 300, 100, { cells: [["A", "B"]] }),
  ];
  const before = structuredClone(source),
    ids = new Set(source.map((i) => i.id)),
    box = bounds(source);
  for (const direction of ["left", "right", "up", "down"]) {
    const { copies } = planDuplication(source, ids, { direction });
    validateBoard({ ...board(), items: [...source, ...copies] });
    const next = bounds(copies);
    assert.equal(
      next.x - box.x,
      direction === "left"
        ? -box.w - 24
        : direction === "right"
          ? box.w + 24
          : 0,
    );
    assert.equal(
      next.y - box.y,
      direction === "up" ? -box.h - 24 : direction === "down" ? box.h + 24 : 0,
    );
    for (let n = 0; n < copies.length; n++) {
      assert.notEqual(copies[n].id, source[n].id);
      assert.deepEqual(
        { ...copies[n], id: source[n].id, x: source[n].x, y: source[n].y },
        source[n],
      );
    }
    copies[0].textRuns[0].style.bold = false;
    copies[3].cells[0][0] = "Independent";
    assert.deepEqual(source, before);
  }
});

test("copied groups and frames retain internal links, detach external endpoints and infer their destination", () => {
  const frame = item("frame", 0, 0, { w: 500, h: 300 }),
    destination = item("frame", 600, 0, { w: 500, h: 400 }),
    a = item("note", 20, 80, {
      parentId: frame.id,
      groupId: "pair",
      locked: true,
      w: 100,
      h: 80,
    }),
    b = item("rect", 350, 80, {
      parentId: frame.id,
      groupId: "pair",
      w: 100,
      h: 80,
    }),
    inside = item("arrow", 0, 0, { startId: a.id, endId: b.id }),
    outside = item("rect", 850, 200),
    external = item("arrow", 0, 0, { startId: b.id, endId: outside.id });
  const items = [frame, destination, a, b, inside, external, outside];
  updateConnectors(items);
  const before = structuredClone(items);
  const group = planDuplication(items, new Set([a.id]), { dx: 600, dy: 0 });
  assert.equal(
    group.copies.length,
    3,
    "A connection between copied nodes is included",
  );
  const [ca, cb, cl] = group.copies;
  assert.equal(ca.groupId, cb.groupId);
  assert.notEqual(ca.groupId, a.groupId);
  assert.equal(cl.startId, ca.id);
  assert.equal(cl.endId, cb.id);
  const combined = [...items, ...group.copies];
  placeDuplicates(combined, group.selection);
  assert.equal(ca.parentId, destination.id);
  assert.equal(cb.parentId, destination.id);
  assert.deepEqual(
    items,
    before,
    "Originals and their external connections never move",
  );
  const container = planDuplication(items, new Set([frame.id]), {
    dx: 0,
    dy: 500,
  });
  placeDuplicates([...items, ...container.copies], container.selection);
  const copiedFrame = container.copies.find((i) => i.type === "frame");
  assert.equal(
    container.copies.filter((i) => i.parentId === copiedFrame.id).length,
    3,
  );
  const line = planDuplication(items, new Set([external.id]), {
    dx: 70,
    dy: 90,
  }).copies[0];
  assert.equal(line.startId, undefined);
  assert.equal(line.endId, undefined);
  assert.equal(line.x, external.x + 70);
  assert.equal(line.y, external.y + 90);
  assert.equal(line.w, external.w);
  validateBoard({ ...board(), items: [...items, ...container.copies, line] });
});

test("duplication fails atomically at capacity and geometry limits and command availability counts connectors", () => {
  const items = Array.from({ length: 4997 }, (_, n) => item("note", n, 0)),
    [a, b] = items,
    line = item("arrow", 0, 0, { startId: a.id, endId: b.id });
  items.push(line);
  const selection = new Set([a.id, b.id]),
    before = structuredClone(items);
  assert.equal(duplicateSourceIds(items, selection).size, 3);
  assert.throws(() => planDuplication(items, selection), /5,000/);
  assert.deepEqual(items, before);
  const commands = commandEntries({ board: { ...board(), items }, selection });
  for (const id of [
    "duplicate",
    "duplicate:up",
    "duplicate:down",
    "duplicate:left",
    "duplicate:right",
  ])
    assert.match(commands.find((c) => c.id === id).disabled, /5,000/);
  const edge = item("note", 999990, 0);
  for (const options of [{ direction: "right" }, { dx: Infinity }, { dx: NaN }])
    assert.throws(
      () => planDuplication([edge], new Set([edge.id]), options),
      /board limits/,
    );
  assert.equal(edge.x, 999990);
  assert.equal(
    planDuplication([edge], new Set(), { direction: "left" }).copies.length,
    0,
  );
});

test("duplication scans a 5000-object board without reading unrelated content or measuring text", () => {
  const items = Array.from({ length: 4999 }, (_, n) => item("rect", n * 2, 0));
  for (const i of items.slice(1))
    Object.defineProperty(i, "text", {
      get() {
        throw Error("Unrelated text was read");
      },
    });
  const plan = planDuplication(items, new Set([items[0].id]), {
    direction: "down",
  });
  assert.equal(plan.copies.length, 1);
  assert.equal(plan.copies[0].y, 184);
  assert.equal(items.length, 4999);
});
