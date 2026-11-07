import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page says it is loading when the app's scripts are slow to arrive", () => {
  // The app waits for Puter's script before it draws anything, so a slow
  // or blocked network otherwise leaves a blank page. The notice appears
  // only once the wait is long enough to notice.
  const html = read("../index.html");
  assert.match(
    html,
    /<div id="app">\s*<p class="app-loading" role="status">\s*Loading your boards…\s*<\/p>\s*<\/div>/,
  );
  const css = read("../src/style.css");
  const at = css.indexOf(".app-loading {");
  assert.ok(at >= 0);
  const rule = css.slice(at, css.indexOf("}", at));
  assert.match(rule, /opacity:\s*0/);
  assert.match(rule, /animation:[^;]*\b\d+ms\b[^;]*forwards/);
  assert.match(css, /@keyframes app-loading-show/);
});
