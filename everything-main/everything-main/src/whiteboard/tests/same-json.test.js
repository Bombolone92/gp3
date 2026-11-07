import test from "node:test";
import assert from "node:assert/strict";
import { sameData, sameJSON } from "../src/same-json.js";

test("sameJSON agrees with comparing serialized JSON", () => {
  const shared = { x: 1 };
  const date = new Date(0);
  const cases = [
    [1, 1],
    [1, 2],
    [null, null],
    [null, {}],
    [
      { a: 1, b: shared },
      { a: 1, b: shared },
    ],
    [
      { a: 1, b: shared },
      { a: 1, b: { x: 1 } },
    ],
    [
      { a: 1, b: 2 },
      { b: 2, a: 1 },
    ],
    [{ a: 1 }, { a: 1, b: undefined }],
    [
      [1, shared],
      [1, shared],
    ],
    [[1, 2], { 0: 1, 1: 2 }],
    [[], {}],
    [date, new Date(1)],
    [date, date],
    [{ toJSON: () => 1 }, { toJSON: () => 2 }],
    ["a", "a"],
    [{ a: NaN }, { a: null }],
  ];
  for (const [a, b] of cases)
    assert.equal(
      sameJSON(a, b),
      JSON.stringify(a) === JSON.stringify(b),
      `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
    );
});

test("sameData compares plain data whatever its key order", () => {
  assert.equal(
    sameData({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
    true,
  );
  assert.equal(sameData({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameData({ a: [1, 2] }, { a: [1, 2, 3] }), false);
  assert.equal(sameData([1, 2], { 0: 1, 1: 2 }), false);
  assert.equal(sameData({ a: NaN }, { a: NaN }), false);
  assert.equal(sameData({ a: "1" }, { a: 1 }), false);
  assert.equal(sameData(null, {}), false);
  assert.equal(sameData("x", "x"), true);
});
