import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { createAI } from "../src/ai/ai-ui.js";
import { language, setLanguage, t } from "../src/i18n.js";

const boardMessage =
  "You’re viewing a different board. Return to the original board to use this draft, or close this dialog and open AI again.";
function setup(locale) {
  const dom = new JSDOM("<body></body>", { url: "https://whiteboard.test" }),
    doc = dom.window.document;
  const previousLanguage = language,
    globals = Object.fromEntries(
      ["document", "localStorage", "navigator"].map((k) => [
        k,
        Object.getOwnPropertyDescriptor(globalThis, k),
      ]),
    );
  const copied = [],
    requests = [];
  for (const [k, value] of Object.entries({
    document: doc,
    localStorage: dom.window.localStorage,
    navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
  }))
    Object.defineProperty(globalThis, k, {
      value,
      configurable: true,
      writable: true,
    });
  setLanguage(locale);
  const original = board("Original board"),
    other = board("Different board");
  original.items = [
    item("note", 0, 0, { id: "one", text: "Original idea one." }),
    item("note", 230, 0, { id: "two", text: "Original idea two." }),
  ];
  // Imported boards can reuse object IDs; membership alone cannot bind a review.
  other.items = [
    item("note", 0, 0, { id: "one", text: "Different idea one." }),
    item("note", 230, 0, { id: "two", text: "Different idea two." }),
  ];
  let current = original,
    writes = 0,
    handler = async (data) => ({
      text:
        data.task === "summarize"
          ? "Original summary."
          : JSON.stringify(
              data.task === "cluster"
                ? { themes: [{ name: "Original theme", notes: [1, 2] }] }
                : { notes: [{ text: "Original generated idea." }] },
            ),
    });
  const ai = createAI({
    org: {
      info: { role: "member" },
      allows: () => true,
      request: async (_op, data) => {
        requests.push(data);
        return handler(data);
      },
    },
    session: () => null,
    board: () => current,
    selection: () => new Set(["one", "two"]),
    modal(_title, html, init) {
      const d = doc.createElement("dialog");
      d.innerHTML = html;
      doc.body.append(d);
      d.open = true;
      d.close = () => {
        d.open = false;
        d.dispatchEvent(new dom.window.Event("close"));
        d.remove();
      };
      init(d);
      return d;
    },
    toast() {},
    icon: () => "",
    mutate: (fn) => {
      writes++;
      fn();
    },
    center: () => ({ x: 0, y: 0 }),
    select() {},
    canEdit: () => true,
    refresh() {},
  });
  const d = ai.open();
  return {
    dom,
    doc,
    ai,
    d,
    original,
    other,
    requests,
    copied,
    writes: () => writes,
    navigate: (b) => (current = b),
    response: (fn) => (handler = fn),
    close() {
      d.close();
      setLanguage(previousLanguage);
      dom.window.close();
      for (const [k, v] of Object.entries(globals)) {
        if (v) Object.defineProperty(globalThis, k, v);
        else delete globalThis[k];
      }
    },
  };
}
async function run(a, task) {
  if (task !== "generate") return a.ai[task](a.d);
  await a.ai.generate(a.d);
  const form = a.d.querySelector("#ai-generate");
  if (!form) return;
  a.d.querySelector("#ai-prompt").value = "Original request.";
  return form.onsubmit(new a.dom.window.Event("submit", { cancelable: true }));
}
const saveSelector = (task) =>
  task === "summarize"
    ? "#ai-add"
    : task === "themes"
      ? "#ai-apply"
      : "#ai-insert";
const fieldSelector = (task) =>
  task === "summarize"
    ? "#ai-summary"
    : task === "themes"
      ? "#ai-theme-0"
      : "#ai-notes";
for (const locale of ["en", "fr"])
  for (const task of ["summarize", "themes", "generate"])
    for (const phase of [
      "before request",
      "pending reply",
      "review ready",
      "return to original",
    ])
      test(`AI ${task} stays with its board ${phase} in ${locale}`, async () => {
        const a = setup(locale);
        let release;
        try {
          const original = JSON.stringify(a.original),
            other = JSON.stringify(a.other);
          if (phase === "before request") a.navigate(a.other);
          if (phase === "pending reply")
            a.response(() => new Promise((resolve) => (release = resolve)));
          const pending = run(a, task);
          if (phase === "pending reply") {
            if (task === "generate")
              await new Promise((resolve) => setImmediate(resolve));
            assert.equal(typeof release, "function");
            a.navigate(a.other);
            release({
              text:
                task === "summarize"
                  ? "Old summary."
                  : JSON.stringify(
                      task === "themes"
                        ? { themes: [{ name: "Old theme", notes: [1, 2] }] }
                        : { notes: [{ text: "Old idea." }] },
                    ),
            });
          }
          await pending;
          if (phase === "before request" || phase === "pending reply") {
            assert.equal(a.requests.length, phase === "before request" ? 0 : 1);
            assert.equal(a.d.querySelector(fieldSelector(task)), null);
            if (task === "generate" && phase === "pending reply")
              assert.equal(
                a.d.querySelector("#ai-prompt").value,
                "Original request.",
              );
          } else {
            const input = a.d.querySelector(fieldSelector(task));
            input.value = "Reviewed draft.";
            a.navigate(a.other);
            a.d.querySelector(saveSelector(task)).click();
            assert.equal(input.value, "Reviewed draft.");
            assert.equal(input.isConnected, true);
            if (task === "summarize") {
              a.d.querySelector("#ai-copy").click();
              await new Promise((resolve) => setImmediate(resolve));
              assert.deepEqual(a.copied, ["Reviewed draft."]);
              // Copy is allowed; a subsequent save still checks the board.
              a.d.querySelector(saveSelector(task)).click();
            }
          }
          assert.equal(
            a.d.querySelector("#ai-status").textContent,
            t(boardMessage),
          );
          assert.equal(a.d.dataset.aiBusy, undefined);
          assert.equal(a.writes(), 0);
          assert.equal(JSON.stringify(a.original), original);
          assert.equal(JSON.stringify(a.other), other);
          if (phase === "return to original") {
            a.navigate(a.original);
            a.d.querySelector(saveSelector(task)).click();
            assert.equal(a.writes(), 1);
            assert.equal(a.d.isConnected, false);
            assert.equal(JSON.stringify(a.other), other);
            assert.ok(
              a.original.items.some((i) => i.text === "Reviewed draft."),
            );
          }
        } finally {
          release?.({ text: "{}" });
          a.close();
        }
      });
for (const locale of ["en", "fr"])
  test(`transcription review preserves its draft after board navigation in ${locale}`, () => {
    const a = setup(locale);
    try {
      a.ai.review(
        a.d,
        [{ text: "Original handwritten note." }],
        "Check the transcription. Edit or remove notes before adding them.",
      );
      const input = a.d.querySelector("#ai-notes");
      input.value = "Reviewed transcription.";
      const original = JSON.stringify(a.original),
        other = JSON.stringify(a.other);
      a.navigate(a.other);
      a.d.querySelector("#ai-insert").click();
      assert.equal(a.writes(), 0);
      assert.equal(input.value, "Reviewed transcription.");
      assert.equal(
        a.d.querySelector("#ai-status").textContent,
        t(boardMessage),
      );
      assert.equal(JSON.stringify(a.original), original);
      assert.equal(JSON.stringify(a.other), other);
      a.navigate(a.original);
      a.d.querySelector("#ai-insert").click();
      assert.equal(a.writes(), 1);
      assert.equal(a.original.items.at(-1).text, "Reviewed transcription.");
      assert.equal(JSON.stringify(a.other), other);
    } finally {
      a.close();
    }
  });
