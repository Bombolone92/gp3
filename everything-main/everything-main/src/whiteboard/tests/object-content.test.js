import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { objectNameHTML } from "../src/accessibility/object-content.js";
import {
  objectName,
  setLanguage,
  language as interfaceLanguage,
} from "../src/i18n.js";

for (const language of ["en", "fr"])
  test(`bounded object captions retain complete Unicode and authored languages in ${language}`, () => {
    const dom = new JSDOM("<main></main>"),
      previous = globalThis.document,
      previousLanguage = interfaceLanguage;
    globalThis.document = dom.window.document;
    try {
      setLanguage(language);
      for (const [type, field] of [
        ["rect", "text"],
        ["note", "text"],
        ["ellipse", "text"],
        ["image", "alt"],
        ["file", "fileName"],
      ])
        for (const locked of [false, true]) {
          const value = 'A<&"' + "😀" + "é" + "🧠" + "Z";
          const node = {
            type,
            locked,
            [field]: value,
            lang: "fr-CA",
            ...(field === "text"
              ? { textRuns: [{ start: 4, end: 6, style: { lang: "en-GB" } }] }
              : {}),
          };
          const before = structuredClone(node),
            full = objectName(node),
            prefix = full.slice(0, full.length - value.length);
          for (const limit of [
            0,
            prefix.length - 1,
            ...Array.from(
              { length: value.length + 2 },
              (_, n) => prefix.length + n,
            ),
            Infinity,
          ]) {
            let expected = prefix;
            for (const character of value) {
              if (expected.length + character.length > limit) break;
              expected += character;
            }
            const host = dom.window.document.querySelector("main");
            host.innerHTML = objectNameHTML(node, limit);
            assert.equal(
              host.textContent,
              expected,
              `${type}/${field}/${locked}/${limit}`,
            );
            assert.equal(host.textContent.isWellFormed(), true);
            assert.equal(
              host.querySelectorAll("[data-user-content]").length,
              1,
            );
            assert.equal(
              host.querySelector("[data-user-content]").getAttribute("lang"),
              "fr-CA",
            );
            const passage = host.querySelector('[lang="en-GB"]');
            if (field === "text" && limit >= prefix.length + 6)
              assert.equal(passage?.textContent, "😀");
            else assert.equal(passage, null);
            assert.equal(
              host.querySelector("script,img,a"),
              null,
              "Authored markup remains text",
            );
            assert.deepEqual(node, before);
          }
        }
    } finally {
      setLanguage(previousLanguage);
      globalThis.document = previous;
      dom.window.close();
    }
  });
