import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
test("the compiled timeline preview wraps its title and date as one normal text flow", () => {
  const name = readdirSync("dist/assets").find(name => name.endsWith(".css") && readFileSync("dist/assets/" + name, "utf8").includes(".task-title-preview"));
  assert.ok(name);
  const dom = new JSDOM('<dialog open><div class="task-title-preview panel"><span lang="fr-CA">Veuillez choisir.</span> (Oct 1, 2026 to Oct 2, 2026)</div></dialog>', { virtualConsole: new VirtualConsole() });
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync("dist/assets/" + name, "utf8");
  dom.window.document.head.append(style);
  const preview = dom.window.document.querySelector(".task-title-preview"), computed = dom.window.getComputedStyle(preview);
  console.log(JSON.stringify({ name, display: computed.display, padding: computed.padding, position: computed.position, overflow: computed.overflow, wrap: computed.overflowWrap }));
  assert.equal(computed.position, "fixed");
  assert.equal(computed.overflow, "auto");
  assert.equal(computed.display, "block", "the common panel style must not split the title and date into flex items");
  dom.window.close();
});
