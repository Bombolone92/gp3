import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createImageReplacement } from "../src/image-replace-ui.js";
import { board, item } from "../src/model.js";
import { setLanguage, language, t } from "../src/i18n.js";

test("replacement choices preserve authored whole-label and passage languages through searching and paging", () => {
  for (const interfaceLanguage of ["en", "fr"]) {
    const dom = new JSDOM("<body></body>"),
      previous = globalThis.document,
      previousLanguage = language;
    globalThis.document = dom.window.document;
    setLanguage(interfaceLanguage);
    const value = board(),
      src = "data:image/png;base64,AA==",
      image = (text, extra = {}) =>
        item("image", 0, 0, { w: 200, h: 100, text, src, ...extra }),
      target = image("Target"),
      whole = image("Bonjour à tous.", { lang: "fr-CA" }),
      mixed = image('Hello. Bonjour à tous. <img src="bad">', {
        lang: "en-CA",
        textRuns: [{ start: 7, end: 22, style: { lang: "fr" } }],
      }),
      empty = image("", { lang: "fr" }),
      long = image("x".repeat(90) + "Bonjour à tous.", {
        textRuns: [{ start: 90, end: 105, style: { lang: "fr" } }],
      }),
      last = image("Guten Morgen zusammen.", { lang: "de-DE" });
    value.items = [target, whole, mixed, empty, long, last];
    const ui = createImageReplacement({
      board: () => value,
      selection: () => new Set([target.id]),
      canEdit: () => true,
      readOnly: () => false,
      toast() {},
      commit() {},
      fileInput() {},
      modal(_title, content, ready) {
        const d = document.createElement("dialog");
        d.innerHTML = content;
        d.open = true;
        d.close = () => {
          d.open = false;
          d.dispatchEvent(new dom.window.Event("close"));
          d.remove();
        };
        document.body.append(d);
        ready(d);
        return d;
      },
    });
    const choice = (i) =>
      document.querySelector(`[data-replacement-source="${i.id}"]`);
    try {
      ui.open();
      document.querySelector("#replacement-board").click();
      assert.equal(choice(whole).querySelector("[lang]")?.lang, "fr-CA");
      assert.equal(
        choice(mixed).querySelector("[data-user-content]").lang,
        "en-CA",
      );
      assert.equal(
        choice(mixed).querySelector('[lang="fr"]').textContent,
        "Bonjour à tous.",
      );
      assert.ok(choice(mixed).textContent.includes('<img src="bad">'));
      assert.equal(
        choice(mixed).querySelectorAll("img").length,
        1,
        "only the decorative thumbnail is an image",
      );
      assert.equal(choice(empty).textContent, `${t("Image")} 3`);
      assert.equal(
        choice(empty).querySelector("[lang]"),
        null,
        "translated fallbacks follow the interface language",
      );
      assert.equal(choice(long).textContent.length, 100);
      assert.equal(
        choice(long).querySelector('[lang="fr"]').textContent,
        "Bonjour à ",
      );
      document.querySelector("#replacement-next").click();
      assert.equal(choice(last).querySelector("[lang]").lang, "de-DE");
      const search = document.querySelector("#replacement-search");
      search.value = "bonjour";
      search.dispatchEvent(new dom.window.Event("input"));
      assert.equal(
        document.querySelectorAll("[data-replacement-source]").length,
        3,
      );
      assert.equal(choice(whole).querySelector("[lang]").lang, "fr-CA");
      assert.equal(
        choice(mixed).querySelector('[lang="fr"]').textContent,
        "Bonjour à tous.",
      );
    } finally {
      ui.close();
      setLanguage(previousLanguage);
      globalThis.document = previous;
      dom.window.close();
    }
  }
});

test("replacement browsing on 5,000 images reads only four thumbnail sources per page and bounds long labels", () => {
  const dom = new JSDOM("<body></body>");
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const value = board(),
    reads = [];
  value.items = Array.from({ length: 5000 }, (_, n) => {
    const image = item("image", n, 0, {
      w: 200,
      h: 100,
      text: "Image " + n + "x".repeat(1000),
    });
    Object.defineProperty(image, "src", {
      get() {
        reads.push(n);
        return "data:image/png;base64,AA==";
      },
    });
    return image;
  });
  const selection = new Set([value.items[0].id]);
  const ui = createImageReplacement({
    board: () => value,
    selection: () => selection,
    canEdit: () => true,
    readOnly: () => false,
    toast() {},
    commit() {},
    fileInput() {},
    modal(_title, content, ready) {
      const d = document.createElement("dialog");
      d.innerHTML = content;
      d.open = true;
      d.close = () => {
        d.open = false;
        d.dispatchEvent(new dom.window.Event("close"));
        d.remove();
      };
      document.body.append(d);
      ready(d);
      return d;
    },
  });
  try {
    ui.open();
    reads.length = 0;
    document.querySelector("#replacement-board").click();
    assert.deepEqual(
      reads.filter((n) => n !== 0),
      [1, 2, 3, 4],
    );
    assert.equal(
      document.querySelectorAll("[data-replacement-source]").length,
      4,
    );
    assert.ok(
      [...document.querySelectorAll(".replacement-grid span")].every(
        (s) => s.textContent.length <= 100,
      ),
    );
    reads.length = 0;
    document.querySelector("#replacement-next").click();
    assert.deepEqual(
      reads.filter((n) => n !== 0),
      [5, 6, 7, 8],
    );
    reads.length = 0;
    for (let n = 0; n < 20; n++) ui.refresh();
    assert.ok(
      reads.every((n) => n === 0),
      "Ordinary drawing does not reread thumbnail data",
    );
    ui.close();
    assert.equal(document.querySelector("dialog"), null);
  } finally {
    ui.close();
    globalThis.document = previous;
    dom.window.close();
  }
});

test("images the workshop hides are not offered as replacements", () => {
  const dom = new JSDOM("<body></body>");
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const value = board();
  const src = "data:image/png;base64,AA==";
  const [target, shown, secret] = ["Target", "Shown", "Secret answer key"].map(
    (text, n) => item("image", n * 300, 0, { w: 200, h: 100, text, src }),
  );
  value.items = [target, shown, secret];
  const selection = new Set([target.id]);
  const ui = createImageReplacement({
    board: () => value,
    selection: () => selection,
    concealed: () => new Set([secret.id]),
    canEdit: () => true,
    readOnly: () => false,
    toast() {},
    commit() {},
    fileInput() {},
    modal(_title, content, ready) {
      const d = document.createElement("dialog");
      d.innerHTML = content;
      d.open = true;
      d.close = () => {
        d.open = false;
        d.remove();
      };
      document.body.append(d);
      ready(d);
      return d;
    },
  });
  try {
    ui.open();
    document.querySelector("#replacement-board").click();
    const offered = [
      ...document.querySelectorAll("[data-replacement-source]"),
    ].map((b) => b.dataset.replacementSource);
    assert.deepEqual(offered, [shown.id]);
    assert.doesNotMatch(document.body.textContent, /Secret/);
  } finally {
    ui.close();
    globalThis.document = previous;
    dom.window.close();
  }
});
