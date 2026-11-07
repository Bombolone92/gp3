import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard, bounds } from "../src/model.js";
import { planClusters, applyClusters } from "../src/clusters.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { moveItems, updateConnectors } from "../src/scene.js";
import { clipboardFormats, readFragment } from "../src/transfer.js";
const ids = (notes) => new Set(notes.map((i) => i.id));
function fixture() {
  const b = board();
  b.tags = [
    { id: "a", name: "Research", color: "#365dc4" },
    { id: "b", name: "Priority", color: "#27834b" },
  ];
  b.items = [
    item("note", -300, -200, {
      text: "First idea",
      tagIds: ["a", "b"],
      groupId: "old",
      w: 120,
      h: 160,
    }),
    item("note", -50, -180, {
      text: "Second idea",
      color: "#d9e9d2",
      tagIds: ["a", "b"],
      groupId: "old",
      w: 180,
      h: 90,
    }),
    item("note", 150, 20, { text: "No tag", w: 120, h: 160 }),
  ];
  b.items[0].objectLink = { objectId: b.items[1].id };
  b.items[0].textRuns = [{ start: 0, end: 5, style: { bold: true } }];
  return b;
}
function disjoint(a, b) {
  return (
    a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
  );
}
test("tag clustering preserves originals, duplicates multi-tag notes, remaps copied links and lays out editable frames", () => {
  const b = fixture(),
    original = structuredClone(b),
    chosen = ids(b.items);
  const plan = planClusters(b, chosen, "tag");
  assert.equal(plan.groups.length, 3);
  assert.equal(plan.copies, 2);
  assert.deepEqual(b, original);
  const created = applyClusters(b, plan),
    frames = b.items.filter((i) => created.has(i.id));
  assert.deepEqual(
    frames.map((i) => i.text),
    ["No tag", "Research", "Priority"],
  );
  assert.equal(b.items.length, 8);
  validateBoard(b);
  for (const f of frames) {
    const notes = b.items.filter((i) => i.parentId === f.id);
    for (const n of notes) {
      const box = bounds([n]);
      assert.ok(box.x >= f.x + 30 && box.y >= f.y + 65);
      assert.ok(box.x + box.w <= f.x + f.w - 30);
      assert.ok(box.y + box.h <= f.y + f.h - 30);
      assert.equal(n.groupId, undefined);
    }
    if (notes.length === 2)
      assert.ok(disjoint(bounds([notes[0]]), bounds([notes[1]])));
  }
  for (let a = 0; a < frames.length; a++)
    for (let c = a + 1; c < frames.length; c++)
      assert.ok(disjoint(frames[a], frames[c]));
  for (const n of original.items)
    assert.equal(b.items.find((i) => i.id === n.id).text, n.text);
  const copy = b.items.find(
    (i) => i.text === "First idea" && !chosen.has(i.id),
  );
  const copyTarget = b.items.find(
    (i) => i.text === "Second idea" && !chosen.has(i.id),
  );
  assert.equal(copy.objectLink.objectId, copyTarget.id);
  copy.textRuns[0].style.bold = false;
  assert.equal(
    b.items.find((i) => i.id === original.items[0].id).textRuns[0].style.bold,
    true,
  );
  const formats = clipboardFormats(b.items, b.tags),
    fragment = readFragment({ getData: (type) => formats[type] || "" });
  assert.equal(fragment.length, b.items.length);
});
test("color and named clustering keep unrelated content and connector endpoints, and frame movement moves its notes", () => {
  const b = fixture(),
    chosen = ids(b.items);
  b.items[1].color = b.items[0].color.toUpperCase();
  delete b.items[2].color;
  const outside = item("rect", 700, 300, { text: "Stay here" }),
    arrow = item("arrow", 0, 0, { startId: b.items[0].id, endId: outside.id });
  b.items.push(outside, arrow);
  updateConnectors(b.items);
  const originalOutside = structuredClone(outside),
    originalArrow = structuredClone(arrow);
  const plan = planClusters(b, chosen, "color");
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.copies, 0);
  const created = applyClusters(b, plan),
    f = b.items.find((i) => created.has(i.id));
  assert.deepEqual(outside, originalOutside);
  assert.notDeepEqual(arrow, originalArrow);
  const before = b.items.filter((i) => chosen.has(i.id)).map((i) => [i.x, i.y]);
  moveItems(b.items, created, 120, 80);
  b.items
    .filter((i) => chosen.has(i.id))
    .forEach((i, n) =>
      assert.deepEqual([i.x, i.y], [before[n][0] + 120, before[n][1] + 80]),
    );
  const named = planClusters(b, chosen, "one", "Next steps");
  assert.equal(named.groups[0].title, "Next steps");
  applyClusters(b, named);
  assert.ok(b.items.includes(f));
  validateBoard(b);
});
test("clustering rejects stale geometry, locked groups, mind nodes, capacity and coordinate overflow before mutation", () => {
  for (const change of [
    (b) => {
      b.items[0].x++;
    },
    (b) => {
      b.items[1].locked = true;
    },
    (b) => {
      b.items[0].mindMap = {
        parent: null,
        direction: "right",
        auto: true,
        line: "curved",
      };
    },
    (b) => {
      b.items.pop();
    },
  ]) {
    const b = fixture(),
      plan = planClusters(b, ids(b.items));
    change(b);
    const before = structuredClone(b);
    assert.throws(() => applyClusters(b, plan));
    assert.deepEqual(b, before);
  }
  const b = fixture(),
    chosen = ids(b.items);
  b.items.push(...Array.from({ length: 4997 }, () => item("rect", 0, 0)));
  const before = structuredClone(b);
  assert.throws(() => planClusters(b, chosen), /5,000/);
  assert.deepEqual(b, before);
  const huge = fixture();
  huge.items[0].x = 999990;
  assert.throws(() => planClusters(huge, ids([huge.items[0]])), /geometry/);
  assert.throws(() => planClusters(fixture(), new Set()), /Select sticky/);
});
test("clustering copies latest text without invalidating geometry plans and shared Undo retains a collaborator's content", () => {
  const b = fixture(),
    selected = ids(b.items),
    initial = new SharedDocument();
  initial.commit(b);
  const a = new SharedDocument(initial.update()),
    c = new SharedDocument(initial.update());
  try {
    let draft = a.snapshot(b.id);
    const plan = planClusters(draft, selected, "tag"),
      fresh = c.snapshot(b.id);
    fresh.items.find((i) => i.id === b.items[0].id).text = "Latest text";
    c.commit(fresh);
    a.apply(c.update());
    draft = a.snapshot(b.id);
    applyClusters(draft, plan);
    assert.equal(draft.items.filter((i) => i.text === "Latest text").length, 2);
    a.commit(draft);
    c.apply(a.update());
    const peer = c.snapshot(b.id);
    peer.items.find((i) => i.id === b.items[0].id).text =
      "Collaborator retained";
    c.commit(peer);
    a.apply(c.update());
    a.undo.undo();
    c.apply(a.update());
    const result = a.snapshot(b.id);
    assert.equal(result.items.length, 3);
    assert.equal(
      result.items.find((i) => i.id === b.items[0].id).text,
      "Collaborator retained",
    );
    assert.equal(
      result.items.find((i) => i.id === b.items[0].id).x,
      b.items[0].x,
    );
    assert.deepEqual(result.items, c.snapshot(b.id).items);
    validateBoard(result);
  } finally {
    initial.destroy();
    a.destroy();
    c.destroy();
  }
});
test("large cluster planning bounds preview data and does not read note text or unrelated content", () => {
  const b = board();
  b.items = Array.from({ length: 4900 }, (_, n) =>
    item("note", (n % 100) * 210, Math.floor(n / 100) * 180),
  );
  for (const n of b.items)
    Object.defineProperty(n, "text", {
      get() {
        throw Error("Preview read content");
      },
    });
  const plan = planClusters(b, ids(b.items));
  assert.equal(plan.count, 4900);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].members.length, 4900);
  assert.equal(plan.copies, 0);
  const small = ids(b.items.slice(0, 2));
  assert.equal(planClusters(b, small).count, 2);
});

test("clusters occupy a nearby free lane without covering existing frames or reading obstacle text", () => {
  const b = fixture(),
    chosen = ids(b.items),
    old = item("frame", -340, -260, {
      w: 1100,
      h: 500,
      text: "Existing frame",
    });
  b.items.push(old);
  for (const n of b.items.filter((i) => chosen.has(i.id))) n.parentId = old.id;
  Object.defineProperty(old, "text", {
    get() {
      throw Error("Read obstacle text");
    },
  });
  const plan = planClusters(b, chosen, "tag");
  for (const group of plan.groups) assert.ok(disjoint(group, old));
  assert.equal(old.x, -340);
  assert.equal(old.y, -260);
  assert.ok(
    plan.groups[0].y >= old.y + old.h + 80 ||
      plan.groups[0].x >= old.x + old.w + 80,
  );
});

test("generated cluster captions capture declared language without inheriting authored tag or note language", () => {
  const b = fixture();
  b.tags[0].name = "Sans étiquette";
  b.items[2].lang = "de-DE";
  b.items[2].textRuns = [{ start: 0, end: 2, style: { lang: "es" } }];
  const original = structuredClone(b);
  const plan = planClusters(b, ids(b.items), "tag", "", {
    noTag: "Sans étiquette",
    language: "fr-ca",
  });
  assert.deepEqual(b, original);
  assert.equal(plan.groups[0].lang, "fr-CA");
  assert.equal(plan.groups[1].title, "Sans étiquette");
  assert.equal(plan.groups[1].lang, undefined);
  assert.equal(plan.groups[2].lang, undefined);
  const made = applyClusters(b, plan);
  const frame = b.items.find((i) => made.has(i.id) && i.lang);
  assert.equal(frame.text, "Sans étiquette");
  assert.equal(frame.lang, "fr-CA");
  const note = b.items.find((i) => i.id === original.items[2].id);
  assert.equal(note.lang, "de-DE");
  assert.deepEqual(note.textRuns, original.items[2].textRuns);
  note.lang = "en";
  note.text = "Later source text";
  assert.equal(frame.lang, "fr-CA");
  assert.equal(frame.text, "Sans étiquette");
  validateBoard(b);
  const shared = new SharedDocument();
  let peer;
  try {
    shared.commit(b);
    peer = new SharedDocument(shared.update());
    assert.equal(
      peer.snapshot(b.id).items.find((i) => i.id === frame.id).lang,
      "fr-CA",
    );
    const formats = clipboardFormats(b.items, b.tags);
    for (const types of [Object.keys(formats), ["text/html"]]) {
      const restored = readFragment({
        getData: (type) => (types.includes(type) ? formats[type] || "" : ""),
      });
      assert.equal(restored.find((i) => i.id === frame.id).lang, "fr-CA");
    }
    assert.equal(
      JSON.parse(JSON.stringify(b)).items.find((i) => i.id === frame.id).lang,
      "fr-CA",
    );
  } finally {
    shared.destroy();
    peer?.destroy();
  }
});

test("cluster languages distinguish built-in captions, declared labels and unknown names", () => {
  const b = fixture(),
    chosen = ids(b.items);
  assert.equal(planClusters(b, chosen, "tag").groups[0].lang, "en");
  assert.equal(
    planClusters(b, chosen, "tag", "", { noTag: "No tag" }).groups[0].lang,
    undefined,
  );
  assert.equal(
    planClusters(b, chosen, "tag", "", { noTag: "No tag", language: 'fr"bad' })
      .groups[0].lang,
    undefined,
  );
  assert.ok(
    planClusters(b, chosen, "color", "", { language: "fr" }).groups.every(
      (g) => g.lang === "en",
    ),
  );
  assert.ok(
    planClusters(b, chosen, "color", "", {
      palette: ["Beurre", "Sauge"],
      language: "fr",
    }).groups.every((g) => g.lang === "fr"),
  );
  assert.ok(
    planClusters(b, chosen, "color", "", {
      palette: ["Butter", "Sage"],
    }).groups.every((g) => g.lang === undefined),
  );
  const unusual = structuredClone(b);
  unusual.items.forEach((i) => (i.color = "#123456"));
  assert.equal(
    planClusters(unusual, ids(unusual.items), "color").groups[0].lang,
    "en",
  );
  assert.equal(
    planClusters(unusual, ids(unusual.items), "color", "", {
      color: "Couleur",
      language: "fr",
    }).groups[0].lang,
    "fr",
  );
  assert.equal(
    planClusters(b, chosen, "one", "No tag", { language: "fr" }).groups[0].lang,
    undefined,
  );
  const themes = [{ name: "Other", ids: [b.items[0].id] }];
  const defaultTheme = planClusters(b, chosen, "themes", "", { themes });
  assert.equal(defaultTheme.groups.find((g) => g.key === "").lang, "en");
  assert.equal(defaultTheme.groups.find((g) => g.key !== "").lang, undefined);
  const declared = planClusters(b, chosen, "themes", "", {
    themes,
    other: "Autre",
    language: "fr-CA",
  });
  assert.equal(declared.groups.find((g) => g.key === "").lang, "fr-CA");
  assert.equal(declared.groups.find((g) => g.key !== "").lang, undefined);
});

test("cluster plans reject changed caption language and normalize equivalent declarations", () => {
  const b = fixture(),
    original = structuredClone(b);
  const labels = { noTag: "No tag", language: "en" };
  const plan = planClusters(b, ids(b.items), "tag", "", labels);
  labels.language = "fr";
  assert.throws(() => applyClusters(b, plan), /selected notes changed/);
  assert.deepEqual(b, original);
  labels.language = "fr-ca";
  const normalized = planClusters(b, ids(b.items), "tag", "", labels);
  labels.language = "fr-CA";
  assert.doesNotThrow(() => applyClusters(b, normalized));
  validateBoard(b);
});

test("theme captions retain bounded language-only metadata without inheriting note or default languages", () => {
  const b = fixture(),
    original = structuredClone(b);
  b.items[0].lang = "es";
  const text = "x".repeat(199) + "😀 Continue.",
    theme = {
      name: text,
      lang: "fr-ca",
      ids: [b.items[0].id],
      textRuns: [
        { start: 198, end: text.length, style: { lang: "en-ca", bold: true } },
      ],
    },
    labels = {
      language: "de",
      themes: [theme, { name: "Canada", ids: [b.items[1].id, b.items[2].id] }],
    };
  const plan = planClusters(b, ids(b.items), "themes", "", labels);
  assert.equal(plan.groups[0].title, "x".repeat(199));
  assert.equal(plan.groups[0].lang, "fr-CA");
  assert.deepEqual(plan.groups[0].textRuns, [
    { start: 198, end: 199, style: { lang: "en-CA" } },
  ]);
  assert.equal(plan.groups[1].lang, undefined);
  const frames = applyClusters(b, plan),
    frame = b.items.find(
      (i) => frames.has(i.id) && i.text === plan.groups[0].title,
    );
  assert.equal(frame.lang, "fr-CA");
  assert.deepEqual(frame.textRuns, plan.groups[0].textRuns);
  assert.equal(b.items.find((i) => i.id === original.items[0].id).lang, "es");
  validateBoard(b);
  const formats = clipboardFormats([frame]);
  for (const types of [Object.keys(formats), ["text/html"]]) {
    const copy = readFragment({
      getData: (type) => (types.includes(type) ? formats[type] || "" : ""),
    })[0];
    assert.equal(copy.lang, "fr-CA");
    assert.deepEqual(copy.textRuns, frame.textRuns);
  }
  frame.textRuns[0].style.lang = "de";
  assert.equal(plan.groups[0].textRuns[0].style.lang, "en-CA");
  assert.equal(theme.textRuns[0].style.lang, "en-ca");
});

test("theme caption declarations participate in stale checks with canonical equivalence and validated ranges", () => {
  const b = fixture(),
    text = "Veuillez lire. Read first.",
    start = text.indexOf("Read first."),
    theme = {
      name: text,
      lang: "fr-ca",
      ids: b.items.map((i) => i.id),
      textRuns: [{ start, end: text.length, style: { lang: "en-ca" } }],
    },
    labels = { themes: [theme] };
  const equivalent = planClusters(b, ids(b.items), "themes", "", labels);
  theme.lang = "fr-CA";
  theme.textRuns[0].style.lang = "en-CA";
  assert.doesNotThrow(() => applyClusters(b, equivalent));
  validateBoard(b);
  const next = fixture(),
    before = structuredClone(next);
  theme.ids = next.items.map((i) => i.id);
  const stale = planClusters(next, ids(next.items), "themes", "", labels);
  theme.textRuns[0].style.lang = "es";
  assert.throws(() => applyClusters(next, stale), /selected notes changed/);
  assert.deepEqual(next, before);
  assert.equal(stale.groups[0].textRuns[0].style.lang, "en-CA");
  theme.textRuns[0].end = text.length + 1;
  assert.throws(
    () => planClusters(next, ids(next.items), "themes", "", labels),
    /text formatting/,
  );
  assert.deepEqual(next, before);
});

test("named cluster captions accept explicit whole/passage content while unknown names retain no inferred language", () => {
  const b = fixture(),
    text = "Veuillez lire. Read first.",
    start = text.indexOf("Read first."),
    content = {
      text,
      lang: "fr-ca",
      textRuns: [
        { start, end: text.length, style: { lang: "en-ca", bold: true } },
      ],
    },
    labels = { language: "es", titleContent: content };
  const plan = planClusters(b, ids(b.items), "one", text, labels);
  assert.equal(plan.groups[0].lang, "fr-CA");
  assert.deepEqual(plan.groups[0].textRuns, [
    { start, end: text.length, style: { lang: "en-CA" } },
  ]);
  const frames = applyClusters(b, plan),
    frame = b.items.find((i) => frames.has(i.id));
  assert.equal(frame.lang, "fr-CA");
  assert.deepEqual(frame.textRuns, plan.groups[0].textRuns);
  validateBoard(b);
  const untouched = fixture();
  assert.equal(
    planClusters(untouched, ids(untouched.items), "one", "Canada", {
      language: "fr",
    }).groups[0].lang,
    undefined,
  );
  frame.textRuns[0].style.lang = "de";
  assert.equal(plan.groups[0].textRuns[0].style.lang, "en-CA");
  assert.equal(content.textRuns[0].style.lang, "en-ca");
});

test("named cluster caption snapshots reject stale bodies and language changes with canonical equivalence", () => {
  const b = fixture(),
    text = "Veuillez lire. Read first.",
    start = text.indexOf("Read first."),
    content = {
      text,
      lang: "fr-ca",
      textRuns: [{ start, end: text.length, style: { lang: "en-ca" } }],
    },
    labels = { titleContent: content },
    plan = planClusters(b, ids(b.items), "one", text, labels);
  content.lang = "fr-CA";
  content.textRuns[0].style.lang = "en-CA";
  assert.doesNotThrow(() => applyClusters(b, plan));
  validateBoard(b);
  const next = fixture(),
    before = structuredClone(next),
    stale = planClusters(next, ids(next.items), "one", text, labels);
  content.textRuns[0].style.lang = "es";
  assert.throws(() => applyClusters(next, stale), /selected notes changed/);
  assert.deepEqual(next, before);
  content.text = "A different heading";
  assert.throws(
    () => planClusters(next, ids(next.items), "one", text, labels),
    /cluster name changed/,
  );
  assert.deepEqual(next, before);
  content.text = text;
  content.textRuns[0].end = text.length + 1;
  assert.throws(
    () => planClusters(next, ids(next.items), "one", text, labels),
    /text formatting/,
  );
  assert.deepEqual(next, before);
});
