import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  pointerFocus,
  keyboardFocus,
  POINTER_FOCUS_CLASS,
} from "../src/navigation.js";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("pointer focus marks the element and focuses it; keyboard focus clears the mark", () => {
  const dom = new JSDOM('<canvas id="canvas" tabindex="0"></canvas>', {
    pretendToBeVisual: true,
  });
  const canvas = dom.window.document.querySelector("#canvas");
  pointerFocus(canvas);
  assert.equal(dom.window.document.activeElement, canvas);
  assert.ok(canvas.classList.contains(POINTER_FOCUS_CLASS));
  keyboardFocus(canvas);
  assert.ok(!canvas.classList.contains(POINTER_FOCUS_CLASS));
  assert.doesNotThrow(() => pointerFocus(null));
  assert.doesNotThrow(() => keyboardFocus(null));
  dom.window.close();
});

test("the stylesheet hides the focus ring of a canvas focused by a click", () => {
  const at = css.indexOf("#canvas.pointer-focus:focus-visible");
  assert.ok(at >= 0, "the board canvas has a pointer-focus rule");
  const open = css.indexOf("{", at);
  const rule = css.slice(open + 1, css.indexOf("}", open));
  assert.match(rule, /outline:\s*none/);
  assert.ok(
    css.slice(at, open).includes("#minimap-canvas.pointer-focus:focus-visible"),
    "the minimap canvas shares the rule",
  );
});
