import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PresenceLayer, color } from "../src/collaboration/presence.js";
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

test("collaborator colours are told apart in small groups and carry white names legibly", () => {
  const luminance = (hex) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const palette = new Set();
  for (let n = 0; n < 2000; n++)
    palette.add(
      color(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
    );
  assert.ok(palette.size >= 12, `${palette.size} colours`);
  for (const tint of palette)
    assert.ok(1.05 / (luminance(tint) + 0.05) >= 4.5, tint);
  // The same person always has the same colour, for everyone.
  assert.equal(color("someone"), color("someone"));
});

test("a collaborator's selection of many objects carries their name once", () => {
  const dom = new JSDOM('<div class="canvas-wrap"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const layer = new PresenceLayer(
      dom.window.document.querySelector(".canvas-wrap"),
    );
    layer.layer.getBoundingClientRect = () => ({ width: 800, height: 600 });
    const notes = [0, 1, 2].map((n) => item("note", 50 + n * 220, 100)),
      away = item("note", 5000, 5000);
    const person = {
      user: "u1",
      username: "Alice",
      cursor: null,
      selection: [away.id, ...notes.map((i) => i.id)],
      editing: null,
    };
    const render = () =>
      layer.render(
        new Map([["peer", person]]),
        [...notes, away],
        { x: 0, y: 0, z: 1 },
        "self",
      );
    const labels = () =>
      [...layer.layer.querySelectorAll(".participant-selection")].map(
        (box) => box.textContent,
      );
    render();
    assert.deepEqual(labels(), ["Alice", "", ""]);
    // What they are editing carries the name…
    person.editing = notes[2].id;
    render();
    assert.deepEqual(labels(), ["", "", "Alice · Editing"]);
    // …and one out of view hands it to the first object in view.
    person.editing = away.id;
    render();
    assert.deepEqual(labels(), ["Alice", "", ""]);
    layer.close();
  } finally {
    dom.window.close();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("several collaborators on one object share one name tag, the editor's first", () => {
  const dom = new JSDOM('<div class="canvas-wrap"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const layer = new PresenceLayer(
      dom.window.document.querySelector(".canvas-wrap"),
    );
    layer.layer.getBoundingClientRect = () => ({ width: 800, height: 600 });
    const note = item("note", 100, 100),
      other = item("note", 400, 100);
    const person = (user, username, selection, editing = null) => ({
      user,
      username,
      cursor: null,
      selection,
      editing,
    });
    const people = new Map([
      ["s1", person("u1", "Bob", [note.id])],
      ["s2", person("u2", "Alice", [note.id], note.id)],
      ["s3", person("u3", "Cam", [other.id])],
    ]);
    const render = () =>
      layer.render(people, [note, other], { x: 0, y: 0, z: 1 }, "self");
    const tags = () =>
      [...layer.layer.querySelectorAll(".participant-selection > span")].map(
        (span) => [span.textContent, span.parentElement.style.left],
      );
    render();
    // One tag on the shared note, the editor's, which is raised above the
    // other outline there; the other note keeps its own.
    assert.deepEqual(tags(), [
      ["Alice · Editing, Bob", "100px"],
      ["Cam", "400px"],
    ]);
    const tagged = layer.layer.querySelector(
      ".participant-selection > span",
    ).parentElement;
    assert.equal(tagged.style.getPropertyValue("--participant"), color("u2"));
    assert.ok(tagged.classList.contains("is-named"));
    assert.equal(
      layer.layer.querySelectorAll(".participant-selection.is-named").length,
      2,
    );
    // Once nobody shares it, each name is on its own outline again.
    people.get("s2").selection = [other.id];
    people.get("s2").editing = null;
    render();
    assert.deepEqual(tags().sort(), [
      ["Alice, Cam", "400px"],
      ["Bob", "100px"],
    ]);
    // A crowd names a few and counts the rest.
    for (const n of [4, 5, 6, 7])
      people.set(`s${n}`, person(`u${n}`, `P${n}`, [other.id]));
    render();
    assert.deepEqual(tags().sort(), [
      ["Alice, Cam, P4 +3", "400px"],
      ["Bob", "100px"],
    ]);
    layer.close();
  } finally {
    dom.window.close();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("a resting collaborator's cursor folds its name away until it moves again", () => {
  const dom = new JSDOM('<div class="canvas-wrap"></div>');
  const previous = globalThis.document,
    now = Date.now;
  globalThis.document = dom.window.document;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    const layer = new PresenceLayer(
      dom.window.document.querySelector(".canvas-wrap"),
    );
    layer.layer.getBoundingClientRect = () => ({ width: 800, height: 600 });
    const person = {
      user: "u1",
      username: "Alice",
      cursor: { x: 100, y: 100 },
      selection: [],
      editing: null,
    };
    const render = () =>
      layer.render(
        new Map([["peer", person]]),
        [],
        { x: 0, y: 0, z: 1 },
        "self",
      );
    render();
    const cursor = layer.layer.querySelector(".participant-cursor");
    assert.equal(cursor.querySelector("span").textContent, "Alice");
    assert.ok(cursor.querySelector("svg"));
    assert.equal(cursor.classList.contains("is-idle"), false);
    clock += 5000;
    render();
    assert.equal(cursor.classList.contains("is-idle"), true);
    // Panning this view is not the other person moving, and cursors move
    // with the view at once rather than glide behind it.
    layer.render(
      new Map([["peer", person]]),
      [],
      { x: 40, y: 0, z: 1 },
      "self",
    );
    assert.equal(cursor.classList.contains("is-idle"), true);
    assert.equal(layer.layer.classList.contains("is-panning"), true);
    // In a big room samples come less often, and cursors glide longer.
    layer.render(
      new Map([["peer", person]]),
      [],
      { x: 40, y: 0, z: 1 },
      "self",
      true,
      40,
    );
    assert.equal(layer.layer.classList.contains("is-panning"), false);
    assert.equal(layer.layer.style.getPropertyValue("--cursor-glide"), "200ms");
    person.cursor = { x: 120, y: 100 };
    render();
    assert.equal(cursor.classList.contains("is-idle"), false);
    layer.close();
  } finally {
    Date.now = now;
    dom.window.close();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
