import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const org = readFileSync(
  new URL("../src/organization/organization.css", import.meta.url),
  "utf8",
);
// The declarations of the first rule whose selector list contains `selector`.
function rule(sheet, selector) {
  const at = sheet.indexOf(selector);
  assert.ok(at >= 0, `${selector} has a rule`);
  const open = sheet.indexOf("{", at);
  return sheet.slice(open + 1, sheet.indexOf("}", open));
}

test("single-line fields, selects, and date inputs stand as tall as the buttons beside them", () => {
  // Buttons set the row height; a 38px select or 40px search box beside a
  // 42px button left filter rows uneven.
  assert.match(rule(css, "button.primary {"), /min-height:\s*42px/);
  assert.match(rule(css, "button.secondary {"), /min-height:\s*42px/);
  assert.match(
    rule(css, '.field input:not([type="checkbox"], [type="radio"]),'),
    /min-height:\s*42px/,
  );
  assert.match(rule(org, ".admin-console select,"), /min-height:\s*42px/);
  // The Share dialog's Copy link button is level with the link field.
  assert.match(rule(css, ".share-link-row > .primary,"), /min-height:\s*42px/);
  // Selects inside table rows, such as a person's role, stay compact.
  assert.match(rule(org, ".admin-table select {"), /min-height:\s*0/);
  // The library's search box stands as tall as the 40px icon buttons in
  // its row.
  assert.match(rule(css, ".search {"), /min-height:\s*40px/);
});

// Class, attribute and pseudo-class selectors in a selector, which is all
// that sets these rules apart; :has() and :not() count their arguments.
const classes = (selector) =>
  (selector.replace(/:(has|not)\(/g, "(").match(/[.[]|:(?!:)/g) || []).length;
// Each innermost rule as its selector and declarations.
const rules = (sheet) =>
  [
    ...sheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map(([, selector, body]) => ({ selector: selector.trim(), body }));

test("the toolbar timer button grows to fit its countdown at every screen size", () => {
  // The navigation buttons take a fixed width per screen size; a rule
  // giving the timer button room for its countdown must outrank each of
  // them, or the countdown spills over the Facilitation button.
  const all = rules(css);
  const fixed = all.filter(
    (r) =>
      r.selector === ".canvas-navigation .icon-btn" &&
      /(^|;)\s*width:/.test(r.body),
  );
  assert.ok(fixed.length >= 3);
  const grow = all.filter(
    (r) => r.selector.includes(".timer-access") && /width:\s*auto/.test(r.body),
  );
  assert.equal(grow.length, 1);
  assert.match(grow[0].selector, /^\.canvas-navigation /);
  for (const r of fixed)
    assert.ok(classes(grow[0].selector) > classes(r.selector), r.body);
});
