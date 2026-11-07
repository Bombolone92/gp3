import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { item } from "../src/model.js";
import { setLanguage } from "../src/i18n.js";
import { objectRelationships } from "../src/accessibility/object-relationships.js";

test("relationship descriptions preserve meaning, language changes and literal authored content", () => {
  const frame = item("frame", 0, 0, { text: "Review" });
  const root = item("note", 0, 0, {
    text: "<img src=x onerror=alert(1)>",
    lang: "en",
    parentId: frame.id,
    groupId: "first-group",
    mindMap: { parent: null },
  });
  const child = item("note", 0, 0, {
    text: "Bonjour",
    lang: "fr",
    parentId: frame.id,
    groupId: "first-group",
    mindMap: { parent: root.id },
  });
  const line = item("arrow", 0, 0, {
    startId: root.id,
    endId: child.id,
    startCap: "arrow",
    endCap: "none",
  });
  const descriptions = objectRelationships([frame, root, child, line]);
  const dom = new JSDOM(`<div>${descriptions.get(line.id)}</div>`);
  try {
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.match(dom.window.document.body.textContent, /<img src=x/);
    assert.equal(
      dom.window.document.querySelector('[lang="fr"]').textContent,
      "Bonjour",
    );
    assert.match(
      dom.window.document.body.textContent,
      /Start: Arrowhead\. End: None/,
    );
    assert.match(descriptions.get(child.id), /Mind map parent:.*&lt;img/);
    assert.match(descriptions.get(root.id), /In frame:.*Review/);
    assert.match(descriptions.get(root.id), /Group 1: 2 visible objects/);
    assert.match(descriptions.get(frame.id), /Contains: 2 visible objects/);
  } finally {
    dom.window.close();
  }
});

test("relationships only name supplied visible objects and distinguish unattached ends in French", () => {
  const dom = new JSDOM();
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    setLanguage("fr");
    const line = item("arrow", 0, 0, {
      startId: "withheld-secret-id",
      parentId: "withheld-frame-id",
      groupId: "visible-group",
      endCap: "circle",
    });
    const description = objectRelationships([line]).get(line.id);
    assert.match(description, /Objet de départ: Objet masqué/);
    assert.match(description, /Objet d’arrivée: Extrémité libre/);
    assert.match(description, /Groupe 1: 1 objet visible/);
    assert.ok(!description.includes("withheld"));
    assert.match(description, /Dans le cadre: Objet masqué/);
    assert.match(description, /Fin: Point/);
  } finally {
    setLanguage("en");
    globalThis.document = previous;
    dom.window.close();
  }
});
