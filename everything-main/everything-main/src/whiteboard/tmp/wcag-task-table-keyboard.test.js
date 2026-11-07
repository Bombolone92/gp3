import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { openTasksDialog } from "./wcag-tasks-dialog-fixed.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";

function setup(lang = "en", tab = "list") {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "https://whiteboard.test", pretendToBeVisual: true });
  const keys = ["document", "localStorage", "HTMLElement", "Node", "Event", "NodeFilter"], previous = Object.fromEntries(keys.map(key => [key, globalThis[key]])), oldLanguage = language;
  for (const key of keys) globalThis[key] = dom.window[key];
  setLanguage(lang);
  const b = board("Tasks"), downloads = [], activated = [];
  b.items = [
    item("note", 0, 0, { text: "First", task: { status: "todo", start: "2026-10-01", due: "2026-10-02" } }),
    item("note", 100, 0, { text: "Complete", task: { status: "done", start: "2026-10-01", due: "2026-10-02" } }),
  ];
  const opened = openTasksDialog({
    board: () => b, now: () => Date.parse("2026-09-30T12:00:00"),
    canAdd: () => false, canPlan: () => false, selectedTasks: () => [],
    jira: { status: () => ({ available: false, message: "" }) },
    modal(title, html, ready) {
      const dialog = document.createElement("dialog"); dialog.innerHTML = html;
      dialog.close = () => { dialog.dispatchEvent(new dom.window.Event("close")); dialog.remove(); };
      document.body.append(dialog); ready(dialog); translateUI(dialog); return dialog;
    },
    focusObject: id => activated.push(id), placeTimeline() {}, setStatusSync() {},
    download: (blob, type) => downloads.push({ blob, type }),
  }, { tab });
  return { ...opened, b, downloads, activated, doc: dom.window.document,
    key(target, key, options = {}) {
      const event = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }); target.dispatchEvent(event); return event;
    },
    close() { opened.dialog.close(); dom.window.close(); setLanguage(oldLanguage); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } },
  };
}
function geometry(table, scroll = 0) {
  Object.defineProperties(table, { scrollWidth: { configurable: true, value: 600 }, clientWidth: { configurable: true, value: 200 } });
  table.scrollLeft = scroll;
}
for (const lang of ["en", "fr"]) test(`Tasks tables support bounded horizontal scrolling, retained group focus and ordinary actions in ${lang}`, async () => {
  const a = setup(lang);
  try {
    const tables = () => [...a.dialog.querySelectorAll("#tasks-list .task-table-wrap")];
    let table = tables()[1];
    assert.equal(table.tabIndex, 0);
    assert.equal(table.getAttribute("role"), "region");
    const heading = a.doc.getElementById(table.getAttribute("aria-labelledby"));
    assert.equal(heading, table.closest("section").querySelector("h3"));
    assert.match(heading.textContent, lang === "fr" ? /Terminée/ : /Done/);
    geometry(table); table.focus();
    for (let i = 0; i < 20; i++) assert.equal(a.key(table, "ArrowRight").defaultPrevented, true);
    assert.equal(table.scrollLeft, 400);
    for (let i = 0; i < 20; i++) a.key(table, "ArrowLeft");
    assert.equal(table.scrollLeft, 0);
    for (const options of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      assert.equal(a.key(table, "ArrowRight", options).defaultPrevented, false);
      assert.equal(table.scrollLeft, 0);
    }
    for (const key of ["Tab", "ArrowDown", "PageDown", "Home", "Enter", " "]) assert.equal(a.key(table, key).defaultPrevented, false);
    assert.equal(a.key(table.querySelector("button"), "ArrowRight").defaultPrevented, false);
    table.scrollLeft = 125;
    a.b.items.push(item("note", 200, 0, { text: "Started", task: { status: "in-progress" } }));
    a.refresh(); table = tables()[2];
    assert.equal(a.doc.activeElement, table);
    assert.equal(table.scrollLeft, 125);
    assert.match(a.doc.getElementById(table.getAttribute("aria-labelledby")).textContent, lang === "fr" ? /Terminée/ : /Done/);
    a.dialog.querySelector("#tasks-csv").click();
    assert.equal(a.downloads[0].type, "csv");
    const csv = await a.downloads[0].blob.text();
    for (const title of ["First", "Complete", "Started"]) assert.ok(csv.includes(title));
    assert.deepEqual(a.activated, []);
    table.focus(); a.b.items = a.b.items.filter(row => row.text !== "Complete"); a.refresh();
    assert.equal(a.doc.activeElement, a.dialog.querySelector("#tasks-tab-list"));
    const row = tables()[0].querySelector("button"); row.click();
    assert.deepEqual(a.activated, [a.b.items.find(row => row.text === "First").id]);
  } finally { a.close(); }
});
for (const lang of ["en", "fr"]) test(`Timeline table is named, scrollable and retains focus after data refresh in ${lang}`, () => {
  const a = setup(lang, "timeline");
  try {
    a.dialog.querySelector("#timeline-table").click();
    let table = a.dialog.querySelector("#timeline-data").parentElement;
    assert.equal(table.tabIndex, 0); assert.equal(table.getAttribute("role"), "region");
    assert.equal(a.doc.getElementById(table.getAttribute("aria-labelledby")), table.querySelector("caption"));
    assert.equal(table.querySelector("caption").textContent, lang === "fr" ? "Chronologie" : "Timeline");
    table.focus();
    assert.equal(a.key(table, "ArrowRight").defaultPrevented, false);
    geometry(table, 390); assert.equal(a.key(table, "ArrowRight").defaultPrevented, true); assert.equal(table.scrollLeft, 400);
    a.b.items[0].text = "Updated"; a.refresh(); table = a.dialog.querySelector("#timeline-data").parentElement;
    assert.equal(a.doc.activeElement, table); assert.equal(table.scrollLeft, 400);
    a.key(table, "Tab"); assert.deepEqual(a.activated, []);
    a.dialog.querySelector("#timeline-table").click();
    assert.equal(a.dialog.querySelector("#timeline-data"), null);
    assert.equal(a.doc.activeElement, a.dialog.querySelector("#timeline-table"));
  } finally { a.close(); }
});
