import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { createAltText } from "../src/accessibility/alt-text.js";
import { setLanguage } from "../src/i18n.js";

const dom = new JSDOM("<body></body>");
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
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  blob: async () => new Blob([""], { type: "image/png" }),
});
try {
  setLanguage("en");
  const b = board("Photos");
  const photo = item("image", 0, 0, {
    id: "p1",
    lang: "fr-CA",
    text: "Une équipe",
    src: "data:image/png;base64,AA==",
    w: 4,
    h: 4,
  });
  b.items = [photo];
  let prompt;
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
      ask: async (mode, request) => {
        prompt = request;
        return request.includes("in English.")
          ? "A team standing together."
          : "Une équipe réunie.";
      },
    },
  });
  alt.open(photo);
  const button = document.querySelector("#alt-suggest");
  button.click();
  for (let n = 0; button.disabled && n < 100; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(button.disabled, false);
  const field = document.querySelector("#alt-text");
  console.log(JSON.stringify({ fieldLanguage: field.lang, prompt, value: field.value }));
  assert.match(prompt, /in fr-CA\./);
  assert.equal(field.value, "Une équipe réunie.");
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.document;
  delete globalThis.Image;
  dom.window.close();
}
