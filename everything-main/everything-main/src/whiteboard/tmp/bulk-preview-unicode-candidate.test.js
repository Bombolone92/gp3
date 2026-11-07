import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createBulkContent } from "./bulk-preview-unicode-candidate.js";
import { board } from "../src/model.js";
import { setLanguage, language } from "../src/i18n.js";
for (const locale of ["en", "fr"])
  for (const spreadsheet of [false, true])
    for (const length of [178, 179, 180])
      test(`bulk previews retain complete Unicode at ${length} characters for ${spreadsheet ? "cells" : "ideas"} in ${locale}`, () => {
        const dom = new JSDOM('<body><canvas id="canvas"></canvas></body>'),
          previous = globalThis.document,
          previousLanguage = language;
        globalThis.document = dom.window.document;
        try {
          setLanguage(locale);
          const value = board(),
            text = "Q".repeat(length) + "😀",
            cells = [[text]],
            metadata = { "0,0": { lang: "fr-CA", textRuns: [{ start: length, end: length + 2, style: { lang: "en-GB" } }] } },
            original = structuredClone({ value, cells, metadata });
          let inserts = 0;
          const ui = createBulkContent({
            board: () => value,
            canAdd: () => true,
            center: () => ({ x: 0, y: 0 }),
            insert() { inserts++; },
            modal(_title, content, ready) {
              const dialog = document.createElement("dialog");
              dialog.innerHTML = content;
              dialog.open = true;
              dialog.close = () => dialog.remove();
              document.body.append(dialog);
              ready(dialog);
              return dialog;
            },
          });
          ui.open(spreadsheet ? cells : undefined, undefined, undefined, spreadsheet ? metadata : undefined);
          if (!spreadsheet) {
            const field = document.querySelector("#bulk-ideas");
            field.value = text;
            field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
          }
          const preview = document.querySelector(".bulk-preview > div");
          assert.equal(preview.textContent, "Q".repeat(length) + (length === 178 ? "😀" : ""));
          assert.equal(preview.textContent.isWellFormed(), true);
          if (spreadsheet) {
            assert.equal(preview.querySelector("[data-user-content]").lang, "fr-CA");
            assert.equal(preview.querySelector('[lang="en-GB"]')?.textContent, length === 178 ? "😀" : undefined);
          }
          document.querySelector("#bulk-cancel").click();
          assert.equal(inserts, 0);
          assert.deepEqual({ value, cells, metadata }, original);
        } finally {
          setLanguage(previousLanguage);
          globalThis.document = previous;
          dom.window.close();
        }
      });
