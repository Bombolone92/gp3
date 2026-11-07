import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { attachMentions } from "../src/mentions.js";

function setup() {
  const dom = new JSDOM(
    '<form><textarea></textarea><button type="button">Other</button></form>',
  );
  const w = dom.window,
    doc = w.document,
    field = doc.querySelector("textarea"),
    previousEvent = globalThis.Event;
  globalThis.Event = w.Event;
  const mentions = attachMentions(field, () => [
    { name: "alice" },
    { name: "alan" },
  ]);
  field.value = "@a";
  field.setSelectionRange(2, 2);
  field.focus();
  field.dispatchEvent(new w.Event("input", { bubbles: true }));
  return {
    w,
    doc,
    field,
    mentions,
    list: doc.querySelector('[role="listbox"]'),
    key(key, extra = {}) {
      const event = new w.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      field.dispatchEvent(event);
      return event;
    },
    close() {
      mentions.detach();
      dom.window.close();
      globalThis.Event = previousEvent;
    },
  };
}

test("mention suggestions leave composition keys to the input method", () => {
  const a = setup();
  try {
    const selected = a.field.getAttribute("aria-activedescendant");
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]) {
        const event = a.key(key, extra);
        assert.equal(event.defaultPrevented, false, key);
        assert.equal(a.field.value, "@a");
        assert.equal(a.field.getAttribute("aria-activedescendant"), selected);
        assert.equal(a.list.hidden, false);
      }
    }
    assert.equal(a.key("ArrowDown").defaultPrevented, true);
    assert.notEqual(a.field.getAttribute("aria-activedescendant"), selected);
    assert.equal(a.key("Enter").defaultPrevented, true);
    assert.equal(a.field.value, "@alice ");
  } finally {
    a.close();
  }
});

test("returning focus keeps mention suggestions available and ordinary blur closes them", (ctx) => {
  ctx.mock.timers.enable({ apis: ["setTimeout"] });
  const a = setup();
  try {
    const other = a.doc.querySelector("button");
    other.focus();
    ctx.mock.timers.tick(50);
    a.field.focus();
    ctx.mock.timers.tick(150);
    assert.equal(a.doc.activeElement, a.field);
    assert.equal(a.list.hidden, false);
    assert.equal(a.key("ArrowDown").defaultPrevented, true);
    other.focus();
    ctx.mock.timers.tick(149);
    assert.equal(a.list.hidden, false);
    ctx.mock.timers.tick(1);
    assert.equal(a.list.hidden, true);
    a.field.focus();
    assert.equal(a.list.hidden, false, "Keyboard return refreshes suggestions");
    a.list.querySelector('[role="option"]').click();
    assert.equal(a.field.value, "@alan ");
  } finally {
    a.close();
  }
});

test("a name chosen from the list keeps to the field's length limit as a typed one does", () => {
  const a = setup();
  try {
    a.field.maxLength = 12;
    a.field.value = "xxxxxxxxx @a";
    a.field.setSelectionRange(12, 12);
    a.field.dispatchEvent(new a.w.Event("input", { bubbles: true }));
    assert.equal(a.list.hidden, false);
    a.key("Enter");
    assert.equal(
      a.field.value,
      "xxxxxxxxx @a",
      "A name that does not fit is not put in",
    );
    assert.equal(a.list.hidden, true);
    a.field.value = "xx @a";
    a.field.setSelectionRange(5, 5);
    a.field.dispatchEvent(new a.w.Event("input", { bubbles: true }));
    a.key("Enter");
    assert.equal(a.field.value, "xx @alan ");
  } finally {
    a.close();
  }
});
