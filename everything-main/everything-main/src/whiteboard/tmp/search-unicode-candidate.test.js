import test from "node:test";
import assert from "node:assert/strict";
import { item } from "../src/model.js";
import {
  createSearchIndex,
  searchIndex,
  searchExcerpt,
} from "./search-unicode-candidate.js";

test("board search finds full content, normalizes accents/case, filters types, and treats queries literally", () => {
  const items = [
    item("note", 0, 0, { text: "Café launch [plan]", locked: true }),
    item("text", 0, 0, { text: "Cafe\u0301 launch" }),
    item("table", 0, 0, {
      text: "Overview",
      cells: [["a".repeat(600), "Buried milestone"]],
    }),
    item("link", 0, 0, {
      text: "Reference",
      url: "https://example.com/launch",
    }),
    item("file", 0, 0, { text: "Budget", fileName: "launch-review.pdf" }),
    item("image", 0, 0, { text: "" }),
  ];
  const index = createSearchIndex(items);
  assert.equal(searchIndex(index, "  CAFE  ").length, 2);
  assert.equal(searchIndex(index, "launch").length, 4);
  assert.deepEqual(
    searchIndex(index, "launch", "file").map((e) => e.item.id),
    [items[4].id],
  );
  assert.equal(searchIndex(index, "[plan]").length, 1);
  assert.equal(searchIndex(index, ".*").length, 0);
  assert.equal(searchIndex(index, "  ").length, 0);
  assert.equal(searchIndex(index, "", "image").length, 1);
  const table = searchIndex(index, "milestone")[0];
  assert.match(searchExcerpt(table, "milestone"), /Buried milestone/);
  assert.ok(searchExcerpt(table, "milestone").length <= 182);
  assert.equal(items[0].locked, true);
});

test("indexed search reuses normalized content across queries on a 5,000-object board", () => {
  let reads = 0;
  const items = Array.from({ length: 5000 }, (_, n) => ({
    id: String(n),
    type: "note",
    get text() {
      reads++;
      return `Planning item ${n}`;
    },
  }));
  const index = createSearchIndex(items);
  assert.equal(reads, 5000);
  for (let n = 0; n < 20; n++)
    assert.equal(searchIndex(index, "planning").length, 5000);
  assert.equal(reads, 5000, "queries do not extract board content again");
});

test("search excerpts locate matches after Unicode normalization changes string length", () => {
  const index = createSearchIndex([
    item("text", 0, 0, { text: "e\u0301".repeat(250) + " milestone" }),
  ]);
  assert.match(
    searchExcerpt(searchIndex(index, "milestone")[0], "milestone"),
    /milestone/,
  );
});
const unicodeSearchCases = [
  ...[178,179,180].map(n=>({name:`end ${n}`,text:"Q".repeat(n)+"😀",query:"Q"})),
  ...[48,49,50].map(n=>({name:`start ${n}`,text:"😀"+"X".repeat(n)+"Q",query:"Q"})),
];
for(const example of unicodeSearchCases)
  test(`board search excerpts retain complete Unicode at ${example.name}`, () => {
    const entries=createSearchIndex([item("note",0,0,{text:example.text})]);
    const matches=searchIndex(entries,example.query);
    assert.equal(matches.length,1);
    const excerpt=searchExcerpt(matches[0],example.query);
    assert.ok(excerpt.includes(example.query));
    assert.equal(excerpt.isWellFormed(),true);
    assert.equal(matches[0].item.text,example.text);
  });
