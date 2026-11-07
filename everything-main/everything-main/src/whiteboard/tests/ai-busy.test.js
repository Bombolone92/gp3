import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { createAI } from "../src/ai/ai-ui.js";

test("while one AI request runs the other actions are disabled, and the photo picker waits too", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  const previous = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const b = board("Notes");
    b.items = [item("note", 0, 0, { text: "An idea" })];
    let release,
      pickers = 0,
      d;
    const ai = createAI({
      org: {
        info: { role: "member" },
        allows: () => true,
        request: () =>
          new Promise((resolve) => {
            release = () => resolve({ text: "Done." });
          }),
      },
      session: () => null,
      board: () => b,
      view: () => b,
      selection: () => new Set(),
      modal(title, html, init) {
        d = document.createElement("dialog");
        d.open = true;
        d.innerHTML = html;
        d.close = () => {
          d.open = false;
          d.remove();
        };
        document.body.append(d);
        init(d);
        return d;
      },
      icon: () => "",
      mutate: (fn) => fn(),
      center: () => ({ x: 0, y: 0 }),
      select() {},
      canEdit: () => true,
      toast() {},
      refresh() {},
      puter: () => null,
      fileInput: () => pickers++,
    });
    ai.open();
    const buttons = [...d.querySelectorAll("[data-ai]")];
    assert.ok(buttons.length > 1);
    // Some actions are already unavailable, such as one for a selection
    // when nothing is selected; those stay as they are.
    const before = buttons.map((button) => button.disabled);
    assert.ok(before.some((disabled) => !disabled));
    const summarize = d.querySelector('[data-ai="summarize"]');
    const running = summarize.onclick();
    assert.ok(
      buttons.every((button) => button.disabled),
      "every action is disabled while the request runs",
    );
    d.querySelector('[data-ai="handwriting"]')?.onclick();
    assert.equal(pickers, 0, "no photo picker opens meanwhile");
    release();
    await running;
    assert.deepEqual(
      buttons.map((button) => button.disabled),
      before,
      "the actions return once the request is done",
    );
  } finally {
    for (const key of keys) globalThis[key] = previous[key];
  }
});
