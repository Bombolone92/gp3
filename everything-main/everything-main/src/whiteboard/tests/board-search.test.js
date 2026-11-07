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

test("Find keeps the page and the focused result when the board changes", async () => {
  const { createBoardSearch } = await import("../src/board-search.js");
  const dom = new JSDOM(
    '<button data-action="board-search"></button><div class="canvas-wrap"><canvas id="canvas" tabindex="0"></canvas></div>',
  );
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const doc = dom.window.document;
    const b = board("Big");
    for (let n = 0; n < 120; n++)
      b.items.push(item("note", n * 10, 0, { text: `Idea ${n}` }));
    const search = createBoardSearch({
      board: () => b,
      draw() {},
      select() {},
      focus() {},
      icon: () => "",
      reveal() {},
    });
    search.open();
    const input = doc.querySelector("#board-search-input");
    input.value = "idea";
    input.dispatchEvent(new dom.window.Event("input"));
    // The first result is reached with Enter, then the next page is read.
    search.keydown({
      key: "Enter",
      target: input,
      preventDefault() {},
    });
    assert.equal(
      doc.querySelector("#board-search-position").textContent,
      "1 / 120",
    );
    doc.querySelector("[data-page='1']").click();
    const page = () => doc.querySelector("#board-search-page").textContent;
    assert.equal(page(), "51–100 / 120");
    const focused = doc.querySelector('[data-result="57"]');
    focused.focus();
    const id = b.items.find((i) => i.text === "Idea 57").id;
    // Someone moves an object: nothing about the list changes.
    b.items[0].x += 5;
    search.refresh();
    assert.equal(page(), "51–100 / 120");
    assert.equal(doc.activeElement.dataset.result, "57");
    // Someone deletes an earlier match: the focused one moves up.
    b.items.splice(0, 1);
    search.refresh();
    assert.equal(page(), "51–100 / 119");
    assert.equal(doc.activeElement.dataset.result, "56");
    assert.match(doc.activeElement.textContent, /Idea 57/);
    assert.ok(b.items.some((i) => i.id === id));
    search.close(false);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
    dom.window.close();
  }
});

test("Find announces its result count once, not as each result is reached", async () => {
  const { createBoardSearch } = await import("../src/board-search.js");
  const dom = new JSDOM(
    '<button data-action="board-search"></button><div class="canvas-wrap"><canvas id="canvas" tabindex="0"></canvas></div>',
  );
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const doc = dom.window.document;
    const b = board("Ideas");
    for (let n = 0; n < 20; n++)
      b.items.push(item("note", n * 10, 0, { text: `Idea ${n}` }));
    const search = createBoardSearch({
      board: () => b,
      draw() {},
      select() {},
      focus() {},
      icon: () => "",
      reveal() {},
    });
    search.open();
    const input = doc.querySelector("#board-search-input");
    input.value = "idea";
    input.dispatchEvent(new dom.window.Event("input"));
    const count = doc.querySelector("#board-search-count");
    assert.equal(count.textContent, "20 results");
    let writes = 0;
    new dom.window.MutationObserver(
      (records) => (writes += records.length),
    ).observe(count, { childList: true, characterData: true, subtree: true });
    for (let n = 0; n < 3; n++)
      search.keydown({ key: "Enter", target: input, preventDefault() {} });
    await new Promise((r) => setTimeout(r));
    assert.equal(writes, 0);
    search.close(false);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
    dom.window.close();
  }
});

test("Find keeps keyboard focus when a refresh turns off the focused control", async () => {
  const { createBoardSearch } = await import("../src/board-search.js");
  const dom = new JSDOM(
    '<button data-action="board-search"></button><div class="canvas-wrap"><canvas id="canvas" tabindex="0"></canvas></div>',
  );
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const doc = dom.window.document;
    const b = board("Big");
    for (let n = 0; n < 60; n++)
      b.items.push(item("note", n * 10, 0, { text: `Idea ${n}` }));
    const search = createBoardSearch({
      board: () => b,
      draw() {},
      select() {},
      focus() {},
      icon: () => "",
      reveal() {},
    });
    search.open();
    const input = doc.querySelector("#board-search-input");
    input.value = "idea";
    input.dispatchEvent(new dom.window.Event("input"));
    doc.querySelector("[data-page='1']").click();
    doc.querySelector("[data-page='-1']").focus();
    // Another person removes matches until one page remains.
    b.items.splice(0, 15);
    search.refresh();
    assert.equal(doc.activeElement, input);
    // The current result is removed while Select on board has focus.
    search.keydown({ key: "Enter", target: input, preventDefault() {} });
    doc.querySelector("#search-select").focus();
    b.items.splice(0, 1);
    search.refresh();
    assert.equal(doc.activeElement, input);
    search.close(false);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
    dom.window.close();
  }
});

test("closing Find returns focus to what opened it, or to the canvas", async () => {
  const { createBoardSearch } = await import("../src/board-search.js");
  const dom = new JSDOM(
    '<button data-action="board-search"></button><button id="palette"></button><div class="canvas-wrap"><canvas id="canvas" tabindex="0"></canvas></div>',
  );
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const doc = dom.window.document;
    const search = createBoardSearch({
      board: () => board("Ideas"),
      draw() {},
      select() {},
      focus() {},
      icon: () => "",
      reveal() {},
    });
    const trigger = doc.querySelector('[data-action="board-search"]'),
      canvas = doc.querySelector("#canvas");
    trigger.focus();
    search.open();
    search.close();
    assert.equal(doc.activeElement, trigger, "the Find button");
    // Ctrl/Cmd+F from the canvas returns there.
    canvas.focus();
    search.open();
    search.close();
    assert.equal(doc.activeElement, canvas);
    // An opener that is gone, as a closed command palette, falls back to
    // the canvas.
    const palette = doc.querySelector("#palette");
    palette.focus();
    search.open();
    palette.remove();
    search.close();
    assert.equal(doc.activeElement, canvas);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
    dom.window.close();
  }
});

test("every search reads curly apostrophes, œ and æ, and compatibility characters as typed", async () => {
  const { filterBoards } = await import("../worker/admin.js");
  const { commandEntries, searchCommands } = await import("../src/commands.js");
  const { fold } = await import("../src/search-fold.js");
  assert.equal(fold("L’Équipe Œuvre ﬁnale"), "l'equipe oeuvre finale");
  assert.equal(fold("Plain ASCII"), "plain ascii");
  // On the board.
  const index = createSearchIndex([
    item("note", 0, 0, { text: "L’équipe valide l’œuvre ﬁnale" }),
  ]);
  for (const query of ["l'equipe", "oeuvre", "finale", "L’ÉQUIPE"])
    assert.equal(searchIndex(index, query).length, 1, query);
  assert.match(searchExcerpt(index[0], "oeuvre"), /l’œuvre/);
  // In the organization's directory, names and content alike.
  const rows = [
    { room: "a", title: "Cœur de métier", text: "" },
    { room: "b", title: "Budget", text: "L’équipe valide le budget" },
  ];
  assert.deepEqual(
    filterBoards(structuredClone(rows), { query: "coeur" }).map((b) => b.room),
    ["a"],
  );
  assert.deepEqual(
    filterBoards(structuredClone(rows), { query: "l'equipe" }).map(
      (b) => b.room,
    ),
    ["b"],
  );
  // In the command palette's boards.
  const target = board("Cœur de métier");
  const entries = commandEntries({ board: board(), boards: [target] });
  assert.equal(searchCommands(entries, "coeur")[0]?.boardId, target.id);
});

test("board search finds every word of the query, in any order and across line breaks", () => {
  const index = createSearchIndex([
    item("note", 0, 0, { text: "Q3\nlaunch  plan" }),
    item("note", 0, 0, { text: "Q4 hiring plan" }),
  ]);
  for (const query of ["q3 launch", "plan launch", "launch plan", " q3  plan "])
    assert.deepEqual(
      searchIndex(index, query).map((e) => e.item.text),
      ["Q3\nlaunch  plan"],
      query,
    );
  assert.equal(searchIndex(index, "plan").length, 2);
  assert.equal(searchIndex(index, "q3 hiring").length, 0);
  // The excerpt starts at the first word when the words are apart.
  const long = createSearchIndex([
    item("note", 0, 0, {
      text: `${"x".repeat(300)} alpha ${"y".repeat(300)} beta`,
    }),
  ]);
  assert.match(searchExcerpt(long[0], "beta alpha"), /^…x+ alpha/);
});

test("board search finds a task by the assignee and Jira issue its badge shows", async () => {
  const index = createSearchIndex([
    item("note", 0, 0, {
      text: "Checkout redesign",
      task: {
        assignee: { id: "u1", name: "Ana López" },
        status: "todo",
        jira: {
          key: "WEB-42",
          url: "https://acme.atlassian.net/browse/WEB-42",
        },
      },
    }),
    item("note", 0, 0, { text: "Unassigned idea" }),
  ]);
  for (const query of ["web-42", "ana lopez", "checkout lopez"])
    assert.deepEqual(
      searchIndex(index, query).map((e) => e.item.text),
      ["Checkout redesign"],
      query,
    );
  // The organization's directory searches the same text.
  const { boardSummary } = await import("../worker/service.js");
  const { text } = boardSummary({
    items: index.map((e) => e.item),
    tags: [],
  });
  assert.match(text, /WEB-42/);
  assert.match(text, /Ana López/);
});

test("the words around a match are found in any script, quickly in long texts", async () => {
  const { fold, wordContext } = await import("../src/search-fold.js");
  assert.deepEqual(wordContext("한국어 예산 회의", fold("예산")), {
    before: "한국어 ",
    hit: "예산",
    after: " 회의",
  });
  // Folding the whole text and each letter alone differ for a final Σ.
  assert.equal(wordContext("ΣΟΦΙΑ ΚΑΙ ΣΟΦΟΣ", fold("σοφος")).hit, "ΣΟΦΟΣ");
  // A separate accent mark stays with its letter in the match.
  assert.equal(wordContext("Café au lait", "cafe").hit, "Café");
  // A word deep in a long text of letters that fold to several is found
  // by tracing the text once, not each letter's folding again.
  const text = "회의 내용 정리 ".repeat(600) + " 예산 " + "회의 ".repeat(5000),
    word = fold("예산"),
    started = performance.now();
  for (let n = 0; n < 50; n++)
    assert.equal(wordContext(text, word, fold(text).indexOf(word)).hit, "예산");
  assert.ok(performance.now() - started < 2000);
});
