import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "@napi-rs/canvas";
import { board, item, validateBoard } from "../src/model.js";
import { createAltText } from "../src/accessibility/alt-text.js";
import { language, setLanguage, t } from "../src/i18n.js";

async function fixture(locale, heldDecode = false) {
  const dom = new JSDOM('<button id="open">Alternative text</button>', {
    url: "https://whiteboard.test",
  });
  const globals = Object.fromEntries(
    ["document", "Image", "fetch"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const previousLanguage = language;
  let decode, resolveReply, notifyRequest, notifyDecode;
  const requested = new Promise((resolve) => (notifyRequest = resolve));
  const decoding = new Promise((resolve) => (notifyDecode = resolve));
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "Image", {
    value: class {
      naturalWidth = 4;
      naturalHeight = 4;
      set src(value) {
        decode = () => this.onload();
        notifyDecode();
        if (!heldDecode) queueMicrotask(decode);
      }
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "fetch", {
    value: async () => ({
      blob: async () => new Blob([], { type: "image/png" }),
    }),
    configurable: true,
    writable: true,
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    drawImage() {},
  });
  dom.window.HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/jpeg;base64,AA==";
  setLanguage(locale);
  const b = board("Description source"),
    canvas = createCanvas(4, 4);
  canvas.getContext("2d").fillStyle = "red";
  canvas.getContext("2d").fillRect(0, 0, 4, 4);
  const photo = item("image", 0, 0, {
    src: canvas.toDataURL(),
    w: 4,
    h: 4,
    alt: "Saved description.",
    lang: "fr-CA",
  });
  b.items = [photo];
  validateBoard(structuredClone(b));
  const prompts = [],
    toasts = [];
  let writes = 0,
    hidden = false,
    d;
  createAltText({
    board: () => b,
    view: () => ({ ...b, items: hidden ? [] : b.items }),
    canEdit: () => true,
    toast: (m) => toasts.push(m),
    mutate(fn) {
      writes++;
      fn();
    },
    ai: {
      availability: () => false,
      ask(...args) {
        prompts.push(args);
        notifyRequest();
        return new Promise((resolve) => (resolveReply = resolve));
      },
    },
    modal(title, html, init) {
      d = document.createElement("dialog");
      d.innerHTML = html;
      d.open = true;
      d.close = () => {
        d.open = false;
        d.dispatchEvent(new dom.window.Event("close"));
        d.remove();
        document.querySelector("#open").focus();
      };
      document.body.append(d);
      init(d);
      return d;
    },
  }).open(photo);
  const field = d.querySelector("#alt-text"),
    button = d.querySelector("#alt-suggest"),
    draft = "Description of the original image.";
  return {
    dom,
    b,
    photo,
    d,
    field,
    button,
    draft,
    prompts,
    toasts,
    requested,
    decoding,
    writes: () => writes,
    finishDecode: () => decode(),
    finishReply: () => resolveReply(' "Suggested description." '),
    hide: () => (hidden = true),
    change(kind) {
      const next = structuredClone(b.items[0]);
      if (kind === "source") {
        canvas.getContext("2d").fillStyle = "blue";
        canvas.getContext("2d").fillRect(0, 0, 4, 4);
        next.src = canvas.toDataURL();
      }
      if (kind === "crop")
        next.crop = { x: 0, y: 0, w: 0.5, h: 1, sourceAspect: 1 };
      if (kind === "mask")
        next.crop = {
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          mask: "ellipse",
          sourceAspect: 1,
        };
      if (kind === "geometry") {
        next.x = 100;
        next.w = 8;
        next.rotation = 90;
      }
      if (kind === "label") next.text = "Collaborator's label";
      if (kind === "crop metadata")
        next.crop = { x: 0, y: 0, w: 1, h: 1, sourceAspect: 1 };
      b.items = [next];
      validateBoard(structuredClone(b));
      return next;
    },
    async idle(finishPending = false) {
      for (let n = 0; button.disabled && n < 100; n++) {
        if (finishPending) resolveReply?.(' "Suggested description." ');
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(button.disabled, false);
    },
    submit() {
      d.querySelector("#alt-form").requestSubmit();
    },
    close() {
      resolveReply?.("Controlled reply.");
      d.close();
      setLanguage(previousLanguage);
      dom.window.close();
      for (const [key, descriptor] of Object.entries(globals))
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    },
  };
}

for (const locale of ["en", "fr"])
  for (const change of ["source", "crop", "mask"])
    for (const phase of ["save", "request", "reply", "decode"])
      test(`alternative description refuses a changed ${change} during ${phase} in ${locale}`, async () => {
        const a = await fixture(locale, phase === "decode");
        try {
          if (phase === "save") {
            a.field.value = a.draft;
            a.field.dispatchEvent(
              new a.dom.window.Event("input", { bubbles: true }),
            );
          }
          if (phase === "reply") {
            a.button.click();
            await a.requested;
          }
          if (phase === "decode") {
            a.button.click();
            await a.decoding;
          }
          a.change(change);
          const changed = JSON.stringify(a.b);
          if (phase === "save") a.submit();
          if (phase === "request") {
            a.button.click();
            await a.idle(true);
          }
          if (phase === "reply") {
            a.finishReply();
            await a.idle();
          }
          if (phase === "decode") {
            a.finishDecode();
            await a.idle(true);
          }
          assert.equal(
            a.prompts.length,
            phase === "reply" ? 1 : 0,
            "A stale dialog must not send a new description request.",
          );
          assert.equal(
            a.writes(),
            0,
            "The old-source draft must not be saved onto changed image content.",
          );
          assert.equal(JSON.stringify(a.b), changed);
          assert.equal(
            a.field.value,
            phase === "save" ? a.draft : "Saved description.",
          );
          assert.equal(a.field.lang, "fr-CA");
          assert.equal(a.d.open, true);
          assert.equal(
            a.d.querySelector("#alt-status").textContent,
            t("This object changed. Open it again to edit it."),
          );
          assert.equal(
            a.d.querySelector("#alt-count").textContent,
            `${a.field.value.length} / 1000`,
          );
        } finally {
          a.close();
        }
      });

for (const locale of ["en", "fr"])
  for (const change of ["geometry", "label", "crop metadata"])
    test(`alternative description preserves a collaborator's ${change} in ${locale}`, async () => {
      const a = await fixture(locale);
      try {
        a.button.click();
        await a.requested;
        const next = a.change(change);
        a.finishReply();
        await a.idle();
        assert.equal(a.field.value, "Suggested description.");
        assert.match(a.prompts[0][1], /in fr-CA\./);
        assert.equal(a.writes(), 0);
        a.submit();
        assert.equal(a.writes(), 1);
        assert.deepEqual(a.b.items, [
          { ...next, alt: "Suggested description." },
        ]);
        assert.equal(a.d.isConnected, false);
        assert.equal(a.dom.window.document.activeElement.id, "open");
      } finally {
        a.close();
      }
    });

for (const locale of ["en", "fr"])
  for (const phase of ["save", "request", "reply", "decode"])
    test(`alternative description preserves its draft when hidden during ${phase} in ${locale}`, async () => {
      const a = await fixture(locale, phase === "decode");
      try {
        if (phase === "save") {
          a.field.value = a.draft;
          a.field.dispatchEvent(new a.dom.window.Event("input"));
        }
        if (phase === "reply") {
          a.button.click();
          await a.requested;
        }
        if (phase === "decode") {
          a.button.click();
          await a.decoding;
        }
        const original = JSON.stringify(a.b);
        a.hide();
        if (phase === "save") a.submit();
        if (phase === "request") {
          a.button.click();
          await a.idle(true);
        }
        if (phase === "decode") {
          a.finishDecode();
          await a.idle(true);
        }
        if (phase === "reply") {
          a.finishReply();
          await a.idle();
        }
        assert.equal(a.prompts.length, phase === "reply" ? 1 : 0);
        assert.equal(a.writes(), 0);
        assert.equal(JSON.stringify(a.b), original);
        assert.equal(
          a.field.value,
          phase === "save" ? a.draft : "Saved description.",
        );
        assert.equal(a.d.open, true);
        assert.equal(
          a.d.querySelector("#alt-status").textContent,
          t("This object is no longer shown to you."),
        );
      } finally {
        a.close();
      }
    });
