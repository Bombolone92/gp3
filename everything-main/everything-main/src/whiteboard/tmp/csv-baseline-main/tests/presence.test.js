import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PresenceLayer } from "../src/collaboration/presence.js";
import { item } from "../src/model.js";

test("live cursors and outlines change the page only when they move, and skip what is out of view", async () => {
  const dom = new JSDOM('<div class="canvas-wrap"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const wrap = dom.window.document.querySelector(".canvas-wrap");
    const layer = new PresenceLayer(wrap);
    layer.layer.getBoundingClientRect = () => ({ width: 800, height: 600 });
    const near = item("note", 100, 100),
      far = item("note", 5000, 5000);
    const people = new Map([
      [
        "peer",
        {
          user: "u1",
          username: "Alice",
          cursor: { x: 50, y: 50 },
          selection: [near.id, far.id],
          editing: null,
        },
      ],
    ]);
    const view = { x: 0, y: 0, z: 1 };
    layer.render(people, [near, far], view, "self");
    assert.equal(
      layer.layer.querySelectorAll(".participant-selection").length,
      1,
    );
    assert.equal(layer.layer.querySelectorAll(".participant-cursor").length, 1);
    const changes = [];
    const observer = new dom.window.MutationObserver((records) =>
      changes.push(...records),
    );
    observer.observe(layer.layer, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    layer.render(people, [near, far], view, "self");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(changes.length, 0, "Nothing is rewritten");
    // Moving the view moves them.
    layer.render(people, [near, far], { x: 10, y: 0, z: 1 }, "self");
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(changes.length > 0);
    observer.disconnect();
    layer.close();
  } finally {
    dom.window.close();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
