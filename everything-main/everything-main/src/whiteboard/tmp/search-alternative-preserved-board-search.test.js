import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import { JSDOM } from "jsdom";
import { authoredTextHTML } from "../src/accessibility/object-content.js";
import {
  createSearchIndex,
  searchIndex,
  searchExcerpt,
} from "../src/board-search.js";

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
  ...[178, 179, 180].map((n) => ({
    name: `end ${n}`,
    expected: n === 178 ? "Q".repeat(n) + "😀" : "Q".repeat(n) + "…",
    text: "Q".repeat(n) + "😀",
    query: "Q",
  })),
  ...[48, 49, 50].map((n) => ({
    name: `start ${n}`,
    expected: n === 50 ? "…" + "X".repeat(n) + "Q" : "😀" + "X".repeat(n) + "Q",
    text: "😀" + "X".repeat(n) + "Q",
    query: "Q",
  })),
];
for (const example of unicodeSearchCases)
  test(`board search excerpts retain complete Unicode at ${example.name}`, () => {
    const entries = createSearchIndex([
      item("note", 0, 0, { text: example.text }),
    ]);
    const matches = searchIndex(entries, example.query);
    assert.equal(matches.length, 1);
    const excerpt = searchExcerpt(matches[0], example.query);
    assert.ok(excerpt.includes(example.query));
    assert.equal(excerpt, example.expected);
    assert.ok(excerpt.length <= 182);
    assert.equal(excerpt.isWellFormed(), true);
    assert.equal(matches[0].item.text, example.text);
  });

const searchImageSource =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAECSURBVHic7dExDQAhAMBAeG2oxSQ/o4AOdwqadI69ziDjex3AzZAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2IMiTEkxpAYQ2J+g7ECtX9sjs0AAAAASUVORK5CYII=";
for (const type of ["image", "pen"])
  test(`Find includes the authored ${type} alternative description and normalized search`, () => {
    const object = item(type, 0, 0, {
      text: "",
      alt: "Résumé 😀",
      lang: "fr-CA",
      ...(type === "pen"
        ? {
            points: [
              [0, 0],
              [100, 80],
            ],
          }
        : { src: searchImageSource }),
    });
    validateBoard({ ...board(), items: [object] });
    const original = structuredClone(object),
      index = createSearchIndex([object]);
    assert.equal(searchIndex(index, "", type).length, 1);
    assert.equal(
      searchExcerpt(searchIndex(index, "", type)[0], ""),
      object.alt,
    );
    assert.equal(searchIndex(index, "  RESUME  ", type).length, 1);
    assert.equal(searchIndex(index, "😀", type).length, 1);
    assert.equal(
      searchIndex(index, "resume", type === "image" ? "pen" : "image").length,
      0,
    );
    assert.deepEqual(object, original);
  });
test("Find retains primary content, links, file names, cells and tag filters", () => {
  const objects = [
    item("note", 0, 0, { text: "Primary <plan>", tagIds: ["tag-1"] }),
    item("file", 0, 0, { text: "Budget", fileName: "review.pdf" }),
    item("link", 0, 0, {
      text: "Reference",
      url: "https://example.com/launch",
    }),
    item("table", 0, 0, { cells: [["Buried milestone"]] }),
  ];
  const index = createSearchIndex(objects, [{ id: "tag-1", name: "Planning" }]);
  for (const query of [
    "Primary <plan>",
    "review.pdf",
    "example.com/launch",
    "milestone",
    "Planning",
  ])
    assert.equal(searchIndex(index, query).length, 1);
  assert.equal(searchIndex(index, "Primary", "", "tag-1").length, 1);
  assert.equal(searchIndex(index, "Primary", "", "other").length, 0);
  assert.equal(searchIndex(index, ".*").length, 0);
  assert.equal(searchIndex(index, "").length, 0);
});
test("Find retains primary and table passage languages alongside metadata", () => {
  const object = item("table", 0, 0, {
    text: "Intro.",
    fileName: "Résumé 😀",
    lang: "de",
    textRuns: [{ start: 0, end: 6, style: { lang: "en-GB" } }],
    cells: [["Bonjour."]],
    cellLanguages: { "0,0": { lang: "fr-CA" } },
  });
  validateBoard({ ...board(), items: [object] });
  const original = structuredClone(object),
    entry = createSearchIndex([object])[0];
  const doc = new JSDOM("").window.document,
    node = doc.createElement("div");
  node.innerHTML = authoredTextHTML(entry.content || entry.item, entry.text);
  assert.equal(node.textContent, "Intro.\nRésumé 😀\nBonjour.");
  assert.equal(node.firstChild.lang, "de");
  assert.equal(node.querySelector('[lang="en-GB"]').textContent, "Intro.");
  assert.equal(node.querySelector('[lang="fr-CA"]').textContent, "Bonjour.");
  assert.equal(searchIndex([entry], "resume").length, 1);
  assert.deepEqual(object, original);
  doc.defaultView.close();
});
test("Find renders alternative descriptions as escaped authored content with their declared language", () => {
  const object = item("pen", 0, 0, {
    text: "",
    alt: "<img src=x onerror=alert(1)> & Résumé 😀",
    lang: "fr-CA",
    points: [
      [0, 0],
      [100, 80],
    ],
  });
  const entry = createSearchIndex([object])[0],
    doc = new JSDOM("").window.document,
    node = doc.createElement("div");
  try {
    node.innerHTML = authoredTextHTML(entry.item, entry.text);
    assert.equal(node.textContent, object.alt);
    assert.equal(node.firstChild.lang, "fr-CA");
    assert.equal(node.querySelector("img"), null);
    assert.equal(searchIndex([entry], "resume").length, 1);
  } finally {
    doc.defaultView.close();
  }
});
test("Find indexes 5,000 alternative descriptions once and reuses them for subsequent queries", () => {
  let reads = 0;
  const objects = Array.from({ length: 5000 }, (_, n) => ({
    id: String(n),
    type: "image",
    text: "",
    get alt() {
      reads++;
      return `Résumé image ${n}`;
    },
  }));
  const index = createSearchIndex(objects);
  assert.equal(reads, 5000);
  for (let n = 0; n < 20; n++)
    assert.equal(searchIndex(index, "resume", "image").length, 5000);
  assert.equal(reads, 5000);
});

test("Find keeps primary passage declarations from applying to alternative descriptions", () => {
  const object = item("image", 0, 0, {
    src: searchImageSource,
    text: "Bonjour.",
    alt: "Résumé 😀",
    lang: "fr-CA",
    textRuns: [{ start: 0, end: 8, style: { lang: "en-GB" } }],
  });
  validateBoard({ ...board(), items: [object] });
  const entry = createSearchIndex([object])[0],
    doc = new JSDOM("").window.document,
    node = doc.createElement("div");
  try {
    node.innerHTML = authoredTextHTML(entry.item, entry.text);
    assert.equal(node.textContent, "Bonjour.\nRésumé 😀");
    assert.equal(node.firstChild.lang, "fr-CA");
    assert.equal(node.querySelector('[lang="en-GB"]').textContent, "Bonjour.");
    assert.equal(searchIndex([entry], "resume").length, 1);
    assert.equal(searchIndex([entry], "bonjour").length, 1);
  } finally {
    doc.defaultView.close();
  }
});
