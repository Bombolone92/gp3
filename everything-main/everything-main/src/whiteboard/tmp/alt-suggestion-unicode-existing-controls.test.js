import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, validateBoard, COLORS } from "../src/model.js";
import {
  boardText,
  noteGrid,
  parseJSON,
  personalAIEnabled,
  replyText,
  replyNotes,
  createAI,
} from "../src/ai/ai-ui.js";
import { planClusters, applyClusters } from "../src/clusters.js";
import { searchGuides, GUIDES } from "../src/help/help-center.js";
import {
  createOnboarding,
  EDITOR_TOUR,
  TOUR_KEY,
} from "../src/help/onboarding.js";

test("AI replies are parsed defensively and board text keeps frames and order", () => {
  assert.deepEqual(parseJSON('Sure!\n```json\n{"notes":[{"text":"A"}]}\n```'), {
    notes: [{ text: "A" }],
  });
  assert.throws(() => parseJSON("no json here"));
  // Ideas may come back as plain strings; empty entries are dropped.
  assert.deepEqual(
    replyNotes({ notes: ["A", { text: " B " }, "", { x: 1 }] }),
    [{ text: "A" }, { text: "B" }],
  );
  assert.deepEqual(replyNotes({ notes: "nope" }), []);
  assert.equal(replyText({ message: { content: "Hi" } }), "Hi");
  assert.equal(
    replyText({ message: { content: [{ text: "A" }, { text: "B" }] } }),
    "AB",
  );
  const frame = item("frame", 0, 0, { text: "Ideas", w: 400, h: 400 });
  const note = item("note", 10, 60, {
    text: "Faster renewals",
    parentId: frame.id,
  });
  const table = item("table", 0, 500, { cells: [["Step", "Owner"]] });
  const text = boardText([frame, note, table]);
  assert.match(text, /\(note, Ideas\) Faster renewals/);
  assert.match(text, /Step \| Owner/);
  assert.equal(boardText([frame, note], new Set([frame.id])), "");
  const notes = noteGrid(
    [
      { text: "A", color: "green" },
      { text: "B", color: "unknown" },
    ],
    { x: 0, y: 0 },
  );
  const b = board("AI");
  b.items = notes;
  validateBoard(b);
  assert.notEqual(notes[0].color, notes[1].color);
  const storage = { getItem: () => "false" };
  assert.equal(personalAIEnabled(storage), false);
  assert.equal(personalAIEnabled({ getItem: () => null }), true);
});

test("AI themes arrange notes into named frames, copying notes in several themes", () => {
  const b = board("Themes");
  const [a, c, d] = ["Queue times", "Online forms", "Call centre"].map(
    (text, n) => item("note", n * 220, 0, { text }),
  );
  b.items = [a, c, d];
  const themes = [
    { name: "Service channels", ids: [c.id, d.id] },
    { name: "Wait times", ids: [a.id, d.id] },
  ];
  const plan = planClusters(b, new Set([a.id, c.id, d.id]), "themes", "", {
    themes,
  });
  const frames = applyClusters(b, plan);
  assert.equal(frames.size, 2);
  const titles = b.items
    .filter((i) => i.type === "frame")
    .map((f) => f.text)
    .sort();
  assert.deepEqual(titles, ["Service channels", "Wait times"]);
  assert.equal(b.items.filter((i) => i.type === "note").length, 4);
  validateBoard(b);
});

test("organization members' AI requests go through the organization and honor its policy", async () => {
  const calls = [];
  const org = {
    info: { role: "member", policy: { ai: { enabled: false } } },
    allows: (f) =>
      f === "ai" ? org.info.policy.ai.enabled : org.info.policy.ai.enabled,
    request: async (op, data) => {
      calls.push([op, data]);
      return { text: "From the organization" };
    },
  };
  const ai = createAI({
    org,
    session: () => ({ room: "r1" }),
    puter: () => null,
  });
  assert.match(ai.availability(), /turned off AI/);
  await assert.rejects(ai.ask("summarize", "x"), /turned off/);
  org.info.policy.ai.enabled = true;
  assert.equal(await ai.ask("summarize", "x"), "From the organization");
  assert.deepEqual(calls[0], [
    "org.ai",
    { task: "summarize", prompt: "x", image: undefined, room: "r1" },
  ]);
});

test("guests use their own Puter AI within the organization's policy", async () => {
  const calls = [];
  const org = {
    info: { role: "guest", policy: { ai: { enabled: true } } },
    allows: (feature) => org.info.policy.ai.enabled || feature !== "ai",
    request: async (op) => (calls.push(op), { text: "Organization" }),
  };
  const ai = createAI({
    org,
    session: () => ({ room: "r1" }),
    puter: () => ({
      ai: { chat: async () => "Personal" },
      auth: { isSignedIn: () => true },
    }),
  });
  assert.equal(await ai.ask("summarize", "x"), "Personal");
  assert.deepEqual(calls, []);
  // A policy that turns AI off applies to guests too.
  org.info.policy.ai.enabled = false;
  await assert.rejects(ai.ask("summarize", "x"), /turned off/);
});

test("signing in for AI applies the organization found at sign-in", async () => {
  const calls = [];
  const org = {
    info: null,
    allows: () => false,
    request: async (op, data) => (calls.push([op, data.task]), { text: "" }),
  };
  let signedIn = false;
  const ai = createAI({
    org,
    session: () => null,
    puter: () => ({
      ai: { chat: async () => "Personal" },
      auth: { isSignedIn: () => signedIn },
    }),
    signIn: async () => {
      signedIn = true;
      org.info = { role: "member", policy: { ai: { enabled: false } } };
    },
  });
  await assert.rejects(ai.ask("summarize", "x"), /turned off AI/);
  assert.deepEqual(calls, []);
});

test("AI summaries include only what the person may see", async () => {
  const b = board("Workshop");
  b.items = [
    item("note", 0, 0, { id: "seen", text: "Shared idea" }),
    item("note", 0, 0, { id: "private", text: "Someone's private note" }),
  ];
  const prompts = [];
  const dom = new JSDOM(
    "<dialog><div id='ai-work'></div><p id='ai-status'></p></dialog>",
  );
  const ai = createAI({
    org: {
      info: { role: "member", policy: { ai: { enabled: true } } },
      allows: () => true,
      request: async (op, data) => (
        prompts.push(data.prompt),
        { text: "Summary" }
      ),
    },
    session: () => null,
    board: () => b,
    view: () => ({ ...b, items: b.items.filter((i) => i.id === "seen") }),
    selection: () => new Set(),
    toast: () => {},
    puter: () => null,
  });
  globalThis.document = dom.window.document;
  try {
    await ai.summarize(dom.window.document.querySelector("dialog"));
  } finally {
    delete globalThis.document;
  }
  assert.match(prompts[0], /Shared idea/);
  assert.doesNotMatch(prompts[0], /private note/);
});

test("a second AI request waits until the first one finishes", async () => {
  const b = board("Retro");
  b.items = [item("note", 0, 0, { id: "n1", text: "Idea" })];
  const prompts = [];
  let release;
  const dom = new JSDOM(
    "<dialog><div id='ai-work'></div><p id='ai-status'></p></dialog>",
  );
  const ai = createAI({
    org: {
      info: { role: "member", policy: { ai: { enabled: true } } },
      allows: () => true,
      request: (op, data) => {
        prompts.push(data.prompt);
        return new Promise((resolve) => (release = resolve));
      },
    },
    session: () => null,
    board: () => b,
    view: () => b,
    selection: () => new Set(),
    toast: () => {},
    puter: () => null,
  });
  globalThis.document = dom.window.document;
  try {
    const d = dom.window.document.querySelector("dialog");
    const first = ai.summarize(d);
    ai.summarize(d);
    await new Promise((r) => setTimeout(r));
    assert.equal(prompts.length, 1);
    assert.equal(d.querySelector("#ai-work").getAttribute("aria-busy"), "true");
    release({ text: "Summary" });
    await first;
    assert.equal(d.querySelector("#ai-summary").value, "Summary");
    assert.equal(d.querySelector("#ai-work").getAttribute("aria-busy"), null);
    // Once it is done, another request can be made.
    const again = ai.summarize(d);
    await new Promise((r) => setTimeout(r));
    assert.equal(prompts.length, 2);
    release({ text: "Second" });
    await again;
  } finally {
    delete globalThis.document;
  }
});

test("help guides are bilingual, role-filtered, and searchable without accents", () => {
  for (const guide of GUIDES) {
    assert.equal(guide.title.length, 2);
    assert.equal(guide.body.length, 2);
    for (const value of [...guide.title, ...guide.body])
      assert.ok(!value.includes("\u2014"));
  }
  assert.ok(searchGuides("sentinel", "admin", "en").length >= 1);
  assert.ok(
    searchGuides("journaux d'audit".replace("'", "’"), "all", "fr").length >= 1,
  );
  // A straight apostrophe, as keyboards type it, finds the same guides.
  assert.equal(
    searchGuides("journaux d'audit", "all", "fr").length,
    searchGuides("journaux d’audit", "all", "fr").length,
  );
  assert.ok(searchGuides("l'IA", "all", "fr").length >= 1);
  assert.ok(
    searchGuides("presentation", "all", "fr").length >= 1,
    "accents are ignored",
  );
  assert.ok(
    searchGuides("", "facilitator").every((g) => g.role === "facilitator"),
  );
  for (const role of ["start", "participant", "facilitator", "admin"])
    assert.ok(searchGuides("", role).length >= 3, role);
});

test("the tour walks available steps, is keyboard operable, and is remembered", () => {
  const dom = new JSDOM(
    `<button data-action="tool-note">N</button><button data-action="share">S</button><button data-action="commands">K</button>`,
    { pretendToBeVisual: true },
  );
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const doc = dom.window.document;
  const tour = createOnboarding({ root: () => doc, storage });
  assert.equal(tour.shouldStart(), true);
  tour.start(EDITOR_TOUR);
  const bubble = doc.querySelector(".tour-bubble");
  assert.equal(bubble.getAttribute("role"), "dialog");
  assert.equal(doc.querySelector("#tour-count").textContent, "1 / 3");
  assert.ok(doc.querySelector(".tour-target"));
  doc.querySelector("#tour-next").click();
  assert.equal(doc.querySelector("#tour-count").textContent, "2 / 3");
  // Focus stays on Next, so the new step is announced.
  assert.match(
    doc.querySelector('#tour-live[role="status"]').textContent,
    /^2 \/ 3\. /,
  );
  // Arrow keys step the tour without reaching the canvas shortcuts.
  let reached = 0;
  doc.addEventListener("keydown", () => reached++);
  const arrow = new dom.window.KeyboardEvent("keydown", {
    key: "ArrowLeft",
    bubbles: true,
    cancelable: true,
  });
  bubble.dispatchEvent(arrow);
  assert.equal(doc.querySelector("#tour-count").textContent, "1 / 3");
  assert.equal(reached, 0);
  assert.equal(arrow.defaultPrevented, true);
  doc.querySelector("#tour-next").click();
  // Following a resize keeps focus where it is.
  doc.querySelector('[data-action="share"]').focus();
  tour.reposition();
  assert.equal(doc.activeElement.dataset.action, "share");
  bubble.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(doc.querySelector(".tour-bubble"), null);
  assert.equal(doc.querySelector(".tour-target"), null);
  assert.equal(JSON.parse(store.get(TOUR_KEY)).done, true);
  assert.equal(tour.shouldStart(), false);
  const shown = [];
  tour.tip("frame", (m) => shown.push(m));
  tour.tip("frame", (m) => shown.push(m));
  assert.equal(shown.length, 1);
  dom.window.close();
});

test("mention suggestions name their list and highlight and insert @username", async () => {
  const { attachMentions, mentionQuery, matchPeople } =
    await import("../src/mentions.js");
  assert.deepEqual(mentionQuery("Hi @al", 6), { start: 3, query: "al" });
  assert.equal(mentionQuery("mail@al", 7), null);
  assert.deepEqual(
    matchPeople(
      [
        { name: "Alice" },
        { name: "alice" },
        { name: "Bob" },
        { name: "has space" },
      ],
      "a",
    ).map((p) => p.name),
    ["Alice"],
  );
  const dom = new JSDOM(`<form><textarea></textarea></form>`);
  globalThis.Event = dom.window.Event;
  const field = dom.window.document.querySelector("textarea");
  let posted = 0;
  field.onkeydown = (e) => e.key === "Enter" && posted++;
  const mentions = attachMentions(field, () => [
    { name: "Alice" },
    { name: "Albert" },
  ]);
  field.value = "Thanks @al";
  field.setSelectionRange(10, 10);
  field.dispatchEvent(new dom.window.Event("input"));
  assert.equal(field.nextElementSibling.hidden, false);
  const key = (k) =>
    field.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }),
    );
  const scrolled = [];
  dom.window.Element.prototype.scrollIntoView = function () {
    scrolled.push(this.id);
  };
  key("ArrowDown");
  assert.equal(
    field.getAttribute("aria-activedescendant").endsWith("-1"),
    true,
  );
  assert.equal(
    scrolled.at(-1),
    field.getAttribute("aria-activedescendant"),
    "the highlighted person scrolls into view",
  );
  key("Enter");
  assert.equal(posted, 0, "Enter chooses the suggestion instead of posting");
  assert.equal(field.value, "Thanks @Alice ");
  assert.equal(field.nextElementSibling.hidden, true);
  // After the caret moves away, Enter no longer inserts a suggestion.
  field.value = "Thanks @al";
  field.setSelectionRange(10, 10);
  field.dispatchEvent(new dom.window.Event("input"));
  field.setSelectionRange(0, 0);
  key("Enter");
  assert.equal(field.value, "Thanks @al");
  assert.equal(field.nextElementSibling.hidden, true);
  // A click chooses a person, as assistive technology and voice control
  // send it; pressing alone keeps focus in the field.
  field.value = "Hi @alb";
  field.setSelectionRange(7, 7);
  field.dispatchEvent(new dom.window.Event("input"));
  const option = field.nextElementSibling.querySelector('[role="option"]');
  const press = new dom.window.MouseEvent("mousedown", { cancelable: true });
  option.dispatchEvent(press);
  assert.equal(press.defaultPrevented, true);
  assert.equal(field.value, "Hi @alb");
  option.click();
  assert.equal(field.value, "Hi @Albert ");
  assert.equal(field.nextElementSibling.hidden, true);
  // Once detached, the field keeps none of its listeners.
  mentions.detach();
  const timer = globalThis.setTimeout;
  let scheduled = 0;
  globalThis.setTimeout = (...args) => (scheduled++, timer(...args));
  field.dispatchEvent(new dom.window.FocusEvent("blur"));
  globalThis.setTimeout = timer;
  assert.equal(scheduled, 0);
  assert.equal(field.nextElementSibling, null);
  dom.window.close();
  delete globalThis.Event;
});

test("notes outside every theme cluster under Other", () => {
  const b = board("Themes");
  b.items = ["a", "b", "c"].map((id, n) =>
    item("note", n * 200, 0, { id, text: id }),
  );
  const plan = planClusters(b, new Set(["a", "b", "c"]), "themes", "", {
    themes: [
      { name: "Speed", ids: ["a"] },
      { name: "Docs", ids: ["b"] },
    ],
    other: "Other",
  });
  assert.deepEqual(plan.groups.map((g) => g.title).sort(), [
    "Docs",
    "Other",
    "Speed",
  ]);
});

test("suggested themes count one note in the singular", async () => {
  const b = board("Workshop");
  b.items = ["One", "Two", "Three"].map((text, n) =>
    item("note", n * 200, 0, { id: `n${n}`, text }),
  );
  const dom = new JSDOM(
    "<dialog><div id='ai-work'></div><p id='ai-status'></p></dialog>",
  );
  const ai = createAI({
    org: {
      info: { role: "member", policy: { ai: { enabled: true } } },
      allows: () => true,
      request: async () => ({
        text: JSON.stringify({
          themes: [
            { name: "Alone", notes: [1] },
            { name: "Pair", notes: [2, 3] },
          ],
        }),
      }),
    },
    session: () => null,
    board: () => b,
    view: () => b,
    selection: () => new Set(["n0", "n1", "n2"]),
    canEdit: () => true,
    toast: () => {},
    puter: () => null,
  });
  globalThis.document = dom.window.document;
  try {
    await ai.themes(dom.window.document.querySelector("dialog"));
    assert.deepEqual(
      [...dom.window.document.querySelectorAll(".ai-themes small")].map(
        (s) => s.textContent,
      ),
      ["1 note", "2 notes"],
    );
  } finally {
    delete globalThis.document;
  }
});

test("a themes reply in the wrong shape says it could not be read", async () => {
  const b = board("Workshop");
  b.items = ["One", "Two", "Three"].map((text, n) =>
    item("note", n * 200, 0, { id: `n${n}`, text }),
  );
  for (const [reply, message, names] of [
    [{ themes: { Access: [1, 2] } }, "The AI reply could not be read.", null],
    [
      { themes: [null, 3, { name: "Loose", notes: "1,2" }, { notes: [2] }] },
      "Review the themes, rename them if needed, then arrange.",
      ["Theme", "Other"],
    ],
  ]) {
    const dom = new JSDOM(
      "<dialog><div id='ai-work'></div><p id='ai-status'></p></dialog>",
    );
    const ai = createAI({
      org: {
        info: { role: "member", policy: { ai: { enabled: true } } },
        allows: () => true,
        request: async () => ({ text: JSON.stringify(reply) }),
      },
      session: () => null,
      board: () => b,
      view: () => b,
      selection: () => new Set(["n0", "n1", "n2"]),
      canEdit: () => true,
      toast: () => {},
      refresh: () => {},
      puter: () => null,
    });
    globalThis.document = dom.window.document;
    try {
      await ai.themes(dom.window.document.querySelector("dialog"));
      const doc = dom.window.document;
      assert.equal(doc.querySelector("#ai-status").textContent, message);
      assert.deepEqual(
        names,
        names && [...doc.querySelectorAll("[data-theme]")].map((i) => i.value),
      );
    } finally {
      delete globalThis.document;
    }
  }
});

test("AI sticky notes take only real colour names", () => {
  const notes = noteGrid(
    ["constructor", "__proto__", "toString", "Blue", undefined].map(
      (color) => ({ text: "Idea", color }),
    ),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    notes.map((n) => n.color),
    [COLORS[0], COLORS[0], COLORS[0], COLORS[2], COLORS[0]],
  );
  const b = board("Photo");
  b.items = notes;
  assert.doesNotThrow(() => structuredClone(b));
  assert.doesNotThrow(() => validateBoard(b));
});

test("AI results refused by a lock report the refusal, not success", async () => {
  const b = board("Workshop");
  b.items = ["One", "Two", "Three"].map((text, n) =>
    item("note", n * 200, 0, { id: `n${n}`, text }),
  );
  const dom = new JSDOM(
    "<dialog><div id='ai-work'></div><p id='ai-status'></p></dialog>",
  );
  const d = dom.window.document.querySelector("dialog");
  d.close = () => (d.closed = true);
  let editable = true;
  const toasts = [];
  const ai = createAI({
    org: {
      info: { role: "member", policy: { ai: { enabled: true } } },
      allows: () => true,
      request: async (op, { task }) => ({
        text:
          task === "cluster"
            ? JSON.stringify({ themes: [{ name: "All", notes: [1, 2, 3] }] })
            : "An overview.",
      }),
    },
    session: () => null,
    board: () => b,
    view: () => b,
    selection: () => new Set(["n0", "n1", "n2"]),
    canEdit: () => {
      if (!editable) toasts.push("Unlock protected objects");
      return editable;
    },
    // Like a save that a facilitator lock refuses: the saved content is
    // put back and the reason shown.
    mutate: (fn) => {
      const saved = structuredClone(b.items);
      fn();
      b.items = saved;
      toasts.push("The board is frozen.");
    },
    select: () => {},
    center: () => ({ x: 0, y: 0 }),
    toast: (m) => toasts.push(m),
    refresh: () => {},
    puter: () => null,
  });
  globalThis.document = dom.window.document;
  try {
    await ai.summarize(d);
    d.querySelector("#ai-add").click();
    assert.deepEqual(toasts, ["The board is frozen."]);
    assert.ok(!d.closed, "The summary stays available to copy");
    toasts.length = 0;
    ai.review(d, [{ text: "Idea" }], "Review");
    d.querySelector("#ai-insert").click();
    assert.deepEqual(toasts, ["The board is frozen."]);
    assert.ok(!d.closed);
    toasts.length = 0;
    await ai.themes(d);
    d.querySelector("#ai-apply").click();
    assert.deepEqual(toasts, ["The board is frozen."]);
    assert.ok(!d.closed);
    // A lock that arrives while the themes are reviewed is checked again.
    toasts.length = 0;
    await ai.themes(d);
    editable = false;
    d.querySelector("#ai-apply").click();
    assert.deepEqual(toasts, ["Unlock protected objects"]);
  } finally {
    delete globalThis.document;
  }
});

test("adding reviewed ideas counts one sticky note in the singular", async () => {
  const b = board("Retro");
  const dom = new JSDOM(
    "<dialog><div id='ai-work'></div><p id='ai-status'></p></dialog>",
  );
  const d = dom.window.document.querySelector("dialog");
  d.close = () => {};
  const toasts = [];
  const ai = createAI({
    org: { info: null, allows: () => true },
    session: () => null,
    board: () => b,
    view: () => b,
    selection: () => new Set(),
    canEdit: () => true,
    mutate: (fn) => fn(),
    select: () => {},
    center: () => ({ x: 0, y: 0 }),
    toast: (m) => toasts.push(m),
    refresh: () => {},
    puter: () => null,
  });
  globalThis.document = dom.window.document;
  try {
    for (const ideas of [["Idea"], ["One", "Two"]]) {
      ai.review(
        d,
        ideas.map((text) => ({ text })),
        "Review",
      );
      d.querySelector("#ai-insert").click();
    }
    assert.deepEqual(toasts, ["1 sticky note added.", "2 sticky notes added."]);
  } finally {
    delete globalThis.document;
  }
});

test("theme prompts for many long notes fit the organization's AI limit", async () => {
  const b = board("Workshop");
  b.items = Array.from({ length: 300 }, (_, n) =>
    item("note", (n % 20) * 200, Math.floor(n / 20) * 200, {
      id: `n${n}`,
      text: `Note ${n} ${"detail ".repeat(80)}`,
    }),
  );
  const dom = new JSDOM(
    "<dialog><div id='ai-work'></div><p id='ai-status'></p></dialog>",
  );
  let prompt = "";
  const ai = createAI({
    org: {
      info: { role: "member", policy: { ai: { enabled: true } } },
      allows: () => true,
      request: async (op, input) => {
        prompt = input.prompt;
        return { text: JSON.stringify({ themes: [] }) };
      },
    },
    session: () => null,
    board: () => b,
    view: () => b,
    selection: () => new Set(b.items.map((i) => i.id)),
    canEdit: () => true,
    toast: () => {},
    refresh: () => {},
    puter: () => null,
  });
  globalThis.document = dom.window.document;
  try {
    await ai.themes(dom.window.document.querySelector("dialog"));
    assert.ok(prompt.length <= 60_000, `${prompt.length} characters`);
    assert.match(prompt, /\n300\. Note 299 detail/);
  } finally {
    delete globalThis.document;
  }
});

test("alternative text is saved only to an image still on the board", async () => {
  const { createAltText } = await import("./alt-suggestion-unicode-candidate.js");
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  try {
    const b = board("Photos");
    const photo = item("image", 0, 0, {
      id: "p1",
      src: "data:image/png;base64,",
      w: 10,
      h: 10,
    });
    b.items = [photo];
    const toasts = [];
    let editable = true,
      saved = 0;
    const alt = createAltText({
      board: () => b,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        d.close = () => d.remove();
        document.body.append(d);
        ready(d);
        return d;
      },
      mutate: (fn) => (fn(), saved++),
      toast: (m) => toasts.push(m),
      canEdit: () => editable,
    });
    const submit = (text) => {
      document.querySelector("#alt-text").value = text;
      document
        .querySelector("#alt-form")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    };
    // A remote update replaced the object: the board's copy gets the text.
    alt.open(photo);
    b.items = [{ ...photo }];
    submit("A team photo");
    assert.equal(b.items[0].alt, "A team photo");
    assert.deepEqual(toasts, ["Alternative text saved."]);
    // Locked meanwhile: nothing is saved and the dialog stays open.
    alt.open(b.items[0]);
    editable = false;
    submit("Changed");
    assert.equal(b.items[0].alt, "A team photo");
    assert.ok(document.querySelector("#alt-form"));
    document.querySelector("dialog").remove();
    // Deleted meanwhile: the dialog says so.
    editable = true;
    alt.open(b.items[0]);
    b.items = [];
    submit("Gone");
    assert.equal(toasts.at(-1), "This image is no longer on the board.");
    assert.equal(saved, 1);
  } finally {
    delete globalThis.document;
  }
});

test("AI alternative-text suggestions use the authored field language with an interface fallback", async () => {
  const { createAltText } = await import("./alt-suggestion-unicode-candidate.js");
  const { language, setLanguage, t } = await import("../src/i18n.js");
  const previousLanguage = language;
  const dom = new JSDOM("<body></body>");
  const realFetch = globalThis.fetch;
  globalThis.document = dom.window.document;
  globalThis.Image = class {
    naturalWidth = 4;
    naturalHeight = 4;
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    drawImage() {},
  });
  dom.window.HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/jpeg;base64,AA==";
  globalThis.fetch = async () => ({
    blob: async () => new Blob([""], { type: "image/png" }),
  });
  try {
    for (const [ui, tag, expected, description] of [
      ["en", "fr-ca", "fr-CA", "Une équipe réunie."],
      ["fr", "EN-gb", "en-GB", "A team standing together."],
      ["en", "de-DE", "de-DE", "Ein Team steht zusammen."],
      ["fr", undefined, "Canadian French", "Une équipe réunie."],
      ["en", "not a language", "English", "A team standing together."],
    ]) {
      setLanguage(ui);
      const b = board("Photos");
      const photo = item("image", 0, 0, {
        id: "p1",
        lang: tag,
        src: "data:image/png;base64,AA==",
        w: 4,
        h: 4,
      });
      b.items = [photo];
      let request;
      const alt = createAltText({
        board: () => b,
        modal: (title, html, ready) => {
          const d = document.createElement("dialog");
          d.innerHTML = html;
          d.close = () => d.remove();
          document.body.append(d);
          ready(d);
          return d;
        },
        mutate: (fn) => fn(),
        toast() {},
        canEdit: () => true,
        ai: {
          availability: () => false,
          ask: async (...args) => {
            request = args;
            return ` "${description}" `;
          },
        },
      });
      alt.open(photo);
      const field = document.querySelector("#alt-text");
      assert.equal(field.lang, expected.includes("-") ? expected : "");
      assert.equal(field.closest("label").getAttribute("lang"), null);
      const button = document.querySelector("#alt-suggest");
      assert.equal(button.textContent, t("Suggest a description with AI"));
      button.click();
      for (let n = 0; button.disabled && n < 100; n++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(button.disabled, false);
      assert.equal(request[0], "describe");
      assert.ok(request[1].includes(`in ${expected}.`), request[1]);
      assert.equal(request[2], "data:image/jpeg;base64,AA==");
      assert.equal(field.value, description);
      assert.equal(document.activeElement, field);
      assert.equal(
        document.querySelector("#alt-status").textContent,
        t("Review the suggestion before saving."),
      );
      assert.equal(photo.alt, undefined, "suggestions still require saving");
      document
        .querySelector("#alt-form")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
      assert.equal(photo.alt, description);
      assert.equal(photo.lang, tag);
      assert.equal(document.querySelector("dialog"), null);
    }
  } finally {
    setLanguage(previousLanguage);
    globalThis.fetch = realFetch;
    delete globalThis.document;
    delete globalThis.Image;
    dom.window.close();
  }
});

test("the tour brings a button scrolled out of its strip into view", () => {
  const dom = new JSDOM(
    `<button data-action="tool-note">N</button><button data-action="share">S</button><button data-action="commands">K</button>`,
    { pretendToBeVisual: true },
  );
  const doc = dom.window.document;
  const scrolled = [];
  dom.window.HTMLElement.prototype.getClientRects = () => [{}];
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) {
    scrolled.push([this.dataset.action, options]);
  };
  const storage = { getItem: () => null, setItem() {} };
  createOnboarding({ root: () => doc, storage }).start(EDITOR_TOUR);
  assert.deepEqual(scrolled[0], [
    "tool-note",
    { block: "nearest", inline: "nearest" },
  ]);
});

test("a tour started from an offer that goes away ends on the canvas", () => {
  const dom = new JSDOM(
    `<canvas id="canvas" tabindex="0"></canvas><button data-action="tool-note">N</button><div id="offer"><button id="take">Tour</button></div>`,
    { pretendToBeVisual: true },
  );
  const doc = dom.window.document;
  const tour = createOnboarding({
    root: () => doc,
    storage: { getItem: () => null, setItem() {} },
    focusCanvas: () => doc.querySelector("#canvas").focus(),
  });
  doc.querySelector("#take").focus();
  doc.querySelector("#offer").remove();
  tour.start(EDITOR_TOUR);
  doc
    .querySelector(".tour-bubble")
    .dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  assert.equal(doc.activeElement.id, "canvas");
});

test("images sent to AI keep dark content on a transparent background visible", async () => {
  const { downscaleDataURL } = await import("../src/ai/ai-ui.js");
  const ops = [];
  const context = {
    set fillStyle(value) {
      ops.push(["fillStyle", value]);
    },
    fillRect: (...args) => ops.push(["fillRect", ...args]),
    drawImage: () => ops.push(["drawImage"]),
  };
  globalThis.document = {
    createElement: () => ({
      getContext: () => context,
      toDataURL: (type) => `data:${type};base64,AA==`,
    }),
  };
  globalThis.Image = class {
    naturalWidth = 3200;
    naturalHeight = 1600;
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    blob: async () => new Blob([""], { type: "image/png" }),
  });
  try {
    const out = await downscaleDataURL("data:image/png;base64,AA==");
    assert.equal(out, "data:image/jpeg;base64,AA==");
    // JPEG has no transparency: transparent pixels would turn black.
    assert.deepEqual(ops, [
      ["fillStyle", "#ffffff"],
      ["fillRect", 0, 0, 1600, 800],
      ["drawImage"],
    ]);
  } finally {
    delete globalThis.document;
    delete globalThis.Image;
    globalThis.fetch = realFetch;
  }
});

test("turning AI on or off on this device keeps focus on the setting", async () => {
  const dom = new JSDOM("<body><button id='opener'>AI</button></body>", {
    url: "https://whiteboard.test",
  });
  const doc = dom.window.document;
  globalThis.document = doc;
  globalThis.localStorage = dom.window.localStorage;
  try {
    const ai = createAI({
      org: { info: {}, allows: () => true },
      session: () => null,
      board: () => board("Retro"),
      selection: () => new Set(),
      toast: () => {},
      icon: () => "",
      // Like the editor's dialogs: an opened dialog focuses its first
      // button, and a closed one is removed a moment later, returning
      // focus to its opener if focus was still inside it.
      modal: (title, html, ready) => {
        const opener = doc.activeElement;
        const d = doc.createElement("dialog");
        d.innerHTML = `<button class="close">Close</button>${html}`;
        d.close = () =>
          setTimeout(() => {
            const restore = d.contains(doc.activeElement);
            d.remove();
            if (restore) opener.focus();
          });
        doc.body.append(d);
        d.querySelector(".close").focus();
        ready(d);
        return d;
      },
    });
    doc.querySelector("#opener").focus();
    ai.open();
    const box = doc.querySelector("#ai-enabled");
    box.focus();
    box.checked = false;
    box.dispatchEvent(new dom.window.Event("change"));
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(localStorage.getItem("whiteboard-ai-enabled"), "false");
    assert.equal(doc.querySelectorAll("dialog").length, 1);
    assert.equal(doc.activeElement.id, "ai-enabled");
    assert.equal(doc.activeElement.checked, false);
    assert.ok(doc.querySelector("[data-ai=summarize]").disabled);
  } finally {
    delete globalThis.document;
    delete globalThis.localStorage;
    dom.window.close();
  }
});

test("the tour and AI settings work where the browser blocks storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  // Reading localStorage throws when site data is blocked.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Access is denied for this document.");
    },
  });
  try {
    const dom = new JSDOM(`<button data-action="tool-note">N</button>`);
    const tour = createOnboarding({ root: () => dom.window.document });
    assert.equal(tour.shouldStart(), true);
    const shown = [];
    tour.tip("frame", (m) => shown.push(m));
    // Without storage, a tip and the tour are still offered once a session.
    tour.tip("frame", (m) => shown.push(m));
    assert.equal(shown.length, 1);
    tour.dismiss();
    assert.equal(tour.shouldStart(), false);
    assert.equal(personalAIEnabled(), true);
    dom.window.close();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

async function feedbackFixture(request, lang = "en") {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "Node",
    "Event",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, globalThis[key]]),
  );
  for (const key of keys) globalThis[key] = dom.window[key];
  const { createHelpCenter } = await import("../src/help/help-center.js");
  const { setLanguage, translateUI } = await import("../src/i18n.js");
  setLanguage(lang);
  const toasts = [];
  let dialog;
  createHelpCenter({
    org: { info: { role: "member" }, request },
    icon: () => "",
    tour() {},
    shortcuts() {},
    refresh: () => translateUI(),
    toast: (message) => toasts.push(message),
    modal(title, html, ready) {
      dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", title);
      dialog.innerHTML = html;
      document.body.append(dialog);
      ready?.(dialog);
      return dialog;
    },
  }).open();
  return {
    dom,
    dialog,
    toasts,
    field: dialog.querySelector("#help-comment"),
    settle: () => new Promise((r) => setTimeout(r, 5)),
    close() {
      dialog.dispatchEvent(new dom.window.Event("close"));
      setLanguage("en");
      dom.window.close();
      for (const key of keys) {
        if (previous[key] === undefined) delete globalThis[key];
        else globalThis[key] = previous[key];
      }
    },
  };
}

test("feedback language authoring preserves a mixed draft through a failed send and suppresses duplicate sends", async () => {
  const requests = [];
  let release;
  const app = await feedbackFixture(async (op, data) => {
    requests.push([op, structuredClone(data)]);
    if (requests.length === 1) throw Error("Try again");
    await new Promise((r) => {
      release = r;
    });
  });
  const { dialog: d, field, dom } = app;
  try {
    assert.equal(field.getAttribute("role"), "textbox");
    assert.equal(field.getAttribute("aria-multiline"), "true");
    assert.equal(
      d.querySelector("#help-comment-label").textContent,
      "What would make it better? (optional)",
    );
    assert.equal(field.getAttribute("aria-labelledby"), "help-comment-label");
    const text =
      '  Start. Veuillez faciliter <img id="pwn-feedback"> la navigation. End.  ';
    field.value = text;
    field.setSelectionRange(0, 0);
    d.querySelector("#help-comment-language-options").click();
    const tag = () => d.querySelector("#help-comment-language-tag");
    tag().value = "bad tag";
    d.querySelector("#help-comment-language-save").click();
    assert.equal(tag().getAttribute("aria-invalid"), "true");
    assert.equal(d.querySelector("#help-comment-language-error").hidden, false);
    tag().value = "en-ca";
    tag().dispatchEvent(new dom.window.Event("input"));
    tag().dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    );
    assert.equal(
      d.querySelector("#help-comment-language-controls").hidden,
      false,
    );
    tag().dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(field.lang, "en-CA");
    assert.equal(requests.length, 0);
    const start = text.indexOf("Veuillez"),
      end = text.indexOf(" End.");
    field.setSelectionRange(start, end);
    d.querySelector("#help-comment-language-options").click();
    assert.equal(d.querySelector("#help-comment-language-scope").value, "text");
    tag().value = "fr-ca";
    d.querySelector("#help-comment-language-save").click();
    assert.equal(
      field.querySelector('[lang="fr-CA"]').textContent,
      text.slice(start, end),
    );
    assert.equal(d.querySelector("#pwn-feedback"), null);
    const runs = [{ start: start - 2, end: end - 2, style: { lang: "fr-CA" } }];
    d.querySelector('[name="help-ease"][value="4"]').checked = true;
    const send = () =>
      d
        .querySelector("#help-feedback")
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        );
    send();
    await app.settle();
    assert.equal(field.value, text);
    assert.deepEqual(field.textRuns, [
      { start, end, style: { lang: "fr-CA" } },
    ]);
    assert.deepEqual(app.toasts, ["Try again"]);
    assert.deepEqual(requests[0], [
      "feedback.submit",
      {
        ease: 4,
        comment: text.trim(),
        lang: "en-CA",
        textRuns: runs,
        context: "help",
      },
    ]);
    send();
    send();
    assert.equal(requests.length, 2);
    release();
    await app.settle();
    assert.equal(d.querySelector("#help-feedback"), null);
    assert.equal(
      document.activeElement.textContent,
      "Thank you for your feedback.",
    );
  } finally {
    app.close();
  }
});

test("feedback whole-comment language can be changed or removed and an empty rating sends no language metadata", async () => {
  const requests = [];
  const app = await feedbackFixture(async (op, data) => {
    requests.push(data);
  }, "fr");
  const { dialog: d, field, dom } = app;
  try {
    assert.equal(field.lang, "fr");
    assert.match(
      d.querySelector("#help-comment-label").textContent,
      /facultatif/,
    );
    d.querySelector("#help-comment-language-options").click();
    d.querySelector("#help-comment-language-tag").value = "de";
    d.querySelector("#help-comment-language-tag").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(field.lang, "fr");
    assert.equal(document.activeElement.id, "help-comment-language-options");
    d.querySelector("#help-comment-language-options").click();
    d.querySelector("#help-comment-language-tag").value = "";
    d.querySelector("#help-comment-language-save").click();
    assert.equal(field.hasAttribute("lang"), false);
    field.value = "   ";
    d.querySelector('[name="help-ease"][value="5"]').checked = true;
    d.querySelector("#help-feedback").dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await app.settle();
    assert.deepEqual(requests, [{ ease: 5, comment: "", context: "help" }]);
    assert.match(document.activeElement.textContent, /Merci/);
  } finally {
    app.close();
  }
});
