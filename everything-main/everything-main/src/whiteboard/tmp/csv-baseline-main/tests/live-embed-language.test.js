import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createLiveEmbeds, MAX_LIVE } from "../src/content/embed-live.js";
import { board, item, validateBoard } from "../src/model.js";
import { language, setLanguage, t } from "../src/i18n.js";

function fixture(options = {}) {
  const dom = new JSDOM(
    '<div class="canvas-wrap"><canvas id="canvas" tabindex="0"></canvas></div>',
    { url: "https://whiteboard.test", pretendToBeVisual: true },
  );
  const doc = dom.window.document;
  const originalLanguage = language;
  const originals = Object.fromEntries(
    ["document", "location"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperties(globalThis, {
    document: { value: doc, configurable: true, writable: true },
    location: {
      value: dom.window.location,
      configurable: true,
      writable: true,
    },
  });
  setLanguage(options.ui || "en");
  const embed = item("embed", 20, 20, {
    id: "video",
    w: 500,
    h: 300,
    text: "Read first. Veuillez lire.",
    lang: "en-CA",
    textRuns: [{ start: 12, end: 26, style: { lang: "fr-CA" } }],
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    provider: "youtube",
    ...options.embed,
  });
  const b = board("Local live-caption fixture");
  b.items = [embed];
  validateBoard(b);
  const state = {
    selection: new Set([embed.id]),
    hidden: new Set(),
    allowed: true,
    view: { x: 0, y: 0, z: 1 },
  };
  const live = createLiveEmbeds({
    board: () => b,
    selection: () => state.selection,
    view: () => state.view,
    allows: () => state.allowed,
    hidden: (id) => state.hidden.has(id),
    toast() {},
  });
  doc.querySelector("#canvas").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 800,
  });
  live.render();
  return {
    doc,
    dom,
    b,
    embed,
    state,
    live,
    opener: doc.querySelector(".embed-open"),
    close() {
      live.closeAll();
      setLanguage(originalLanguage);
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}

function labels(doc, control) {
  return control
    .getAttribute("aria-labelledby")
    .split(/\s+/)
    .map((id) => {
      const label = doc.getElementById(id);
      assert.ok(label, `Existing label ${id}`);
      return label;
    });
}

test("live embed captions separate translated controls from literal whole and passage declarations", () => {
  for (const ui of ["en", "fr"]) {
    const a = fixture({ ui });
    try {
      const [action, caption] = labels(a.doc, a.opener);
      assert.equal(action.textContent, t("Open live"));
      assert.equal(
        caption.querySelector('[lang="en-CA"]').textContent,
        a.embed.text,
      );
      assert.equal(
        caption.querySelector('[lang="fr-CA"]').textContent,
        "Veuillez lire.",
      );
      a.opener.focus();
      a.opener.click();
      const root = a.doc.querySelector(".embed-live");
      const [prefix, title] = labels(a.doc, root);
      const frame = root.querySelector("iframe");
      assert.equal(prefix.textContent, t("Live embed"));
      assert.equal(prefix.closest("[lang]").lang, ui);
      assert.equal(
        title.querySelector('[lang="fr-CA"]').textContent,
        "Veuillez lire.",
      );
      assert.deepEqual(labels(a.doc, frame), [title]);
      assert.equal(frame.title, a.embed.text);
      assert.equal(frame.lang, "en-CA");
      a.embed.text =
        'Veuillez lire <img id="live-injection"> les prochaines étapes.';
      a.embed.lang = "fr-CA";
      delete a.embed.textRuns;
      a.live.render();
      assert.equal(
        title.querySelector('[lang="fr-CA"]').textContent,
        a.embed.text,
      );
      assert.equal(title.querySelector("img,script,b,strong,a"), null);
      assert.equal(frame.lang, "fr-CA");
      assert.equal(frame.title, a.embed.text);
      assert.equal(a.doc.querySelector("#live-injection"), null);
    } finally {
      a.close();
    }
  }
});

test("metadata-only live caption changes retain frame, labels and focus; unchanged draws retain text nodes", () => {
  const a = fixture();
  try {
    a.opener.focus();
    a.opener.click();
    const frame = a.doc.querySelector("iframe");
    const src = frame.src;
    const root = a.doc.querySelector(".embed-live");
    const [, title] = labels(a.doc, root);
    const firstNode = title.firstChild;
    const focused = a.doc.activeElement;
    const ids = root.getAttribute("aria-labelledby");
    for (let n = 0; n < 4; n++) a.live.render();
    assert.equal(title.firstChild, firstNode);
    a.embed.lang = "en-gb";
    a.embed.textRuns[0].style.lang = "fr-fr";
    a.live.render();
    assert.equal(
      title.querySelector('[lang="en-GB"]').textContent,
      a.embed.text,
    );
    assert.equal(
      title.querySelector('[lang="fr-FR"]').textContent,
      "Veuillez lire.",
    );
    assert.equal(frame.lang, "en-GB");
    assert.equal(a.doc.querySelector("iframe"), frame);
    assert.equal(frame.src, src);
    assert.equal(a.doc.activeElement, focused);
    assert.equal(root.getAttribute("aria-labelledby"), ids);
    delete a.embed.lang;
    a.live.render();
    assert.equal(frame.hasAttribute("lang"), false);
    assert.equal(
      title.querySelector('[lang="fr-FR"]').textContent,
      "Veuillez lire.",
    );
    delete a.embed.textRuns;
    a.live.render();
    assert.equal(title.querySelector("[lang]"), null);
    a.live.close(a.embed.id, true);
    assert.equal(a.doc.activeElement, a.opener);
    assert.equal(labels(a.doc, a.opener)[1].querySelector("[lang]"), null);
    assert.equal(a.doc.querySelector("iframe"), null);
  } finally {
    a.close();
  }
});

test("unknown captions and empty provider fallbacks do not inherit stale object language metadata", () => {
  const a = fixture({
    ui: "fr",
    embed: {
      text: "Read the instructions.",
      lang: undefined,
      textRuns: undefined,
    },
  });
  try {
    assert.equal(labels(a.doc, a.opener)[1].querySelector("[lang]"), null);
    a.opener.click();
    const frame = a.doc.querySelector("iframe");
    const title = labels(a.doc, frame)[0];
    assert.equal(frame.hasAttribute("lang"), false);
    assert.equal(title.querySelector("[lang]"), null);
    a.embed.text = "";
    a.embed.lang = "fr-CA";
    a.live.render();
    assert.equal(frame.title, "YouTube");
    assert.equal(frame.hasAttribute("lang"), false);
    assert.equal(title.textContent, "YouTube");
    assert.equal(title.querySelector("[lang]"), null);
  } finally {
    a.close();
  }
});

test("live caption references stay unique through eviction, policy changes and hidden selection", () => {
  const a = fixture();
  try {
    a.state.selection.clear();
    for (let n = 0; n <= MAX_LIVE; n++) {
      const e = { ...a.embed, id: `video-${n}` };
      a.b.items.push(e);
      assert.equal(a.live.open(e), true);
    }
    assert.equal(a.live.count(), MAX_LIVE);
    assert.equal(a.live.isOpen("video-0"), false);
    const ids = [...a.doc.querySelectorAll("[id]")].map((el) => el.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const el of a.doc.querySelectorAll("[aria-labelledby]"))
      labels(a.doc, el);
    a.state.allowed = false;
    a.live.render();
    assert.equal(a.live.count(), 0);
    assert.equal(a.live.open(a.embed), false);
    a.state.allowed = true;
    a.state.selection.add(a.embed.id);
    a.live.render();
    assert.equal(a.opener.hidden, false);
    a.state.hidden.add(a.embed.id);
    a.live.render();
    assert.equal(a.opener.hidden, true);
    assert.equal(a.live.open(a.embed), false);
    assert.equal(a.doc.querySelector("iframe"), null);
  } finally {
    a.close();
  }
});
