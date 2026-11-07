import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { openTasksDialog } from "../src/planning/tasks-dialog.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";

function setup(lang = "en", tab = "list", access = { plan: false }) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://whiteboard.test",
    pretendToBeVisual: true,
  });
  const keys = [
      "document",
      "localStorage",
      "HTMLElement",
      "Node",
      "Event",
      "NodeFilter",
    ],
    previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]])),
    oldLanguage = language;
  for (const key of keys) globalThis[key] = dom.window[key];
  setLanguage(lang);
  const b = board("Tasks"),
    downloads = [],
    activated = [];
  b.items = [
    item("note", 0, 0, {
      text: "First",
      task: { status: "todo", start: "2026-10-01", due: "2026-10-02" },
    }),
    item("note", 100, 0, {
      text: "Complete",
      task: { status: "done", start: "2026-10-01", due: "2026-10-02" },
    }),
  ];
  const opened = openTasksDialog(
    {
      board: () => b,
      now: () => Date.parse("2026-09-30T12:00:00"),
      canAdd: () => access.plan,
      canPlan: () => access.plan,
      selectedTasks: () => [],
      jira: { status: () => ({ available: false, message: "" }) },
      modal(title, html, ready) {
        const dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        dialog.close = () => {
          dialog.dispatchEvent(new dom.window.Event("close"));
          dialog.remove();
        };
        document.body.append(dialog);
        ready(dialog);
        translateUI(dialog);
        return dialog;
      },
      focusObject: (id) => activated.push(id),
      placeTimeline() {},
      setStatusSync() {},
      download: (blob, type) => downloads.push({ blob, type }),
    },
    { tab },
  );
  return {
    ...opened,
    b,
    access,
    downloads,
    activated,
    doc: dom.window.document,
    key(target, key, options = {}) {
      const event = new dom.window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      target.dispatchEvent(event);
      return event;
    },
    close() {
      opened.dialog.close();
      dom.window.close();
      setLanguage(oldLanguage);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}
function geometry(table, scroll = 0) {
  Object.defineProperties(table, {
    scrollWidth: { configurable: true, value: 600 },
    clientWidth: { configurable: true, value: 200 },
  });
  table.scrollLeft = scroll;
}
for (const lang of ["en", "fr"])
  test(`Tasks tables support bounded horizontal scrolling, retained group focus and ordinary actions in ${lang}`, async () => {
    const a = setup(lang);
    try {
      const tables = () => [
        ...a.dialog.querySelectorAll("#tasks-list .task-table-wrap"),
      ];
      let table = tables()[1];
      assert.equal(table.tabIndex, 0);
      assert.equal(table.getAttribute("role"), "region");
      const heading = a.doc.getElementById(
        table.getAttribute("aria-labelledby"),
      );
      assert.equal(heading, table.closest("section").querySelector("h3"));
      assert.match(heading.textContent, lang === "fr" ? /Terminée/ : /Done/);
      geometry(table);
      table.focus();
      for (let i = 0; i < 20; i++)
        assert.equal(a.key(table, "ArrowRight").defaultPrevented, true);
      assert.equal(table.scrollLeft, 400);
      for (let i = 0; i < 20; i++) a.key(table, "ArrowLeft");
      assert.equal(table.scrollLeft, 0);
      for (const options of [
        { shiftKey: true },
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
        { isComposing: true },
        { keyCode: 229 },
      ]) {
        assert.equal(
          a.key(table, "ArrowRight", options).defaultPrevented,
          false,
        );
        assert.equal(table.scrollLeft, 0);
      }
      for (const key of ["Tab", "ArrowDown", "PageDown", "Home", "Enter", " "])
        assert.equal(a.key(table, key).defaultPrevented, false);
      assert.equal(
        a.key(table.querySelector("button"), "ArrowRight").defaultPrevented,
        false,
      );
      table.scrollLeft = 125;
      a.b.items.push(
        item("note", 200, 0, {
          text: "Started",
          task: { status: "in-progress" },
        }),
      );
      a.refresh();
      table = tables()[2];
      assert.equal(a.doc.activeElement, table);
      assert.equal(table.scrollLeft, 125);
      assert.match(
        a.doc.getElementById(table.getAttribute("aria-labelledby")).textContent,
        lang === "fr" ? /Terminée/ : /Done/,
      );
      a.dialog.querySelector("#tasks-csv").click();
      assert.equal(a.downloads[0].type, "csv");
      const csv = await a.downloads[0].blob.text();
      for (const title of ["First", "Complete", "Started"])
        assert.ok(csv.includes(title));
      assert.deepEqual(a.activated, []);
      table.focus();
      a.b.items = a.b.items.filter((row) => row.text !== "Complete");
      a.refresh();
      assert.equal(
        a.doc.activeElement,
        a.dialog.querySelector("#tasks-tab-list"),
      );
      const row = tables()[0].querySelector("button");
      row.click();
      assert.deepEqual(a.activated, [
        a.b.items.find((row) => row.text === "First").id,
      ]);
    } finally {
      a.close();
    }
  });
for (const lang of ["en", "fr"])
  test(`Timeline table is named, scrollable and retains focus after data refresh in ${lang}`, () => {
    const a = setup(lang, "timeline");
    try {
      a.dialog.querySelector("#timeline-table").click();
      let table = a.dialog.querySelector("#timeline-data").parentElement;
      assert.equal(table.tabIndex, 0);
      assert.equal(table.getAttribute("role"), "region");
      assert.equal(
        a.doc.getElementById(table.getAttribute("aria-labelledby")),
        table.querySelector("caption"),
      );
      assert.equal(
        table.querySelector("caption").textContent,
        lang === "fr" ? "Chronologie" : "Timeline",
      );
      table.focus();
      assert.equal(a.key(table, "ArrowRight").defaultPrevented, false);
      geometry(table, 390);
      assert.equal(a.key(table, "ArrowRight").defaultPrevented, true);
      assert.equal(table.scrollLeft, 400);
      a.b.items[0].text = "Updated";
      a.refresh();
      table = a.dialog.querySelector("#timeline-data").parentElement;
      assert.equal(a.doc.activeElement, table);
      assert.equal(table.scrollLeft, 400);
      a.key(table, "Tab");
      assert.deepEqual(a.activated, []);
      a.dialog.querySelector("#timeline-table").click();
      assert.equal(a.dialog.querySelector("#timeline-data"), null);
      assert.equal(
        a.doc.activeElement,
        a.dialog.querySelector("#timeline-table"),
      );
    } finally {
      a.close();
    }
  });

test("a Tasks control that becomes disabled while focused hands focus to the open tab", () => {
  const a = setup("en", "timeline", { plan: true });
  try {
    for (const selector of ["#tasks-sync", "#timeline-place"]) {
      a.access.plan = true;
      a.refresh();
      const control = a.dialog.querySelector(selector);
      assert.equal(control.disabled, false);
      control.focus();
      assert.equal(a.doc.activeElement, control);
      // The board is locked, or this person can no longer plan.
      a.access.plan = false;
      a.refresh();
      assert.equal(a.dialog.querySelector(selector).disabled, true);
      assert.equal(
        a.doc.activeElement,
        a.dialog.querySelector("#tasks-tab-timeline"),
        `${selector} gives focus to the tab, not the page`,
      );
    }
  } finally {
    a.close();
  }
});

test("exports from the Timeline hold the tasks it shows, not the List's filters", async () => {
  const a = setup();
  try {
    const status = a.dialog.querySelector("#tasks-status");
    status.value = "done";
    status.dispatchEvent(
      new a.doc.defaultView.Event("change", { bubbles: true }),
    );
    const exported = async () => {
      a.dialog.querySelector("#tasks-csv").click();
      return a.downloads.at(-1).blob.text();
    };
    assert.doesNotMatch(await exported(), /First/);
    a.dialog.querySelector("#tasks-tab-timeline").click();
    const csv = await exported();
    for (const title of ["First", "Complete"])
      assert.match(csv, new RegExp(title));
    // Back on the List, its filters apply again.
    a.dialog.querySelector("#tasks-tab-list").click();
    assert.doesNotMatch(await exported(), /First/);
  } finally {
    a.close();
  }
});

for (const lang of ["en", "fr"])
  test(`a board with many tasks lists and charts them a page at a time in ${lang}`, () => {
    const a = setup(lang);
    try {
      a.b.items = Array.from({ length: 250 }, (_, n) =>
        item("note", n * 10, 0, {
          text: `Task ${n}`,
          task: {
            status: "todo",
            start: "2026-10-01",
            due: `2026-10-${String(2 + (n % 20)).padStart(2, "0")}`,
          },
        }),
      );
      a.refresh();
      const rows = () => a.dialog.querySelectorAll("#tasks-list .task-go");
      const more = () => a.dialog.querySelector("#tasks-list [data-task-more]");
      assert.equal(rows().length, 100);
      const count = a.doc.getElementById(
        more().getAttribute("aria-describedby"),
      );
      assert.equal(
        count.textContent,
        lang === "fr"
          ? "100 tâches affichées sur 250."
          : "Showing 100 of 250 tasks.",
      );
      more().focus();
      more().click();
      assert.equal(rows().length, 200);
      // The keyboard moves on to the first task added.
      assert.equal(a.doc.activeElement, rows()[100]);
      // A remote change keeps the tasks shown.
      a.b.items = [...a.b.items];
      a.b.items[0] = { ...a.b.items[0], text: "Renamed" };
      a.refresh();
      assert.equal(rows().length, 200);
      more().click();
      assert.equal(rows().length, 250);
      assert.equal(more(), null);
      a.dialog.querySelector("#tasks-tab-timeline").click();
      const bars = () => a.dialog.querySelectorAll(".timeline-bar");
      const barMore = () => a.dialog.querySelector("#timeline-more");
      assert.equal(bars().length, 100);
      assert.equal(
        a.doc.getElementById(barMore().getAttribute("aria-describedby"))
          .textContent,
        lang === "fr"
          ? "100 tâches affichées sur 250."
          : "Showing 100 of 250 tasks.",
      );
      // Arrow keys and End stay within the bars shown.
      bars()[0].focus();
      a.key(bars()[0], "End");
      assert.equal(a.doc.activeElement, bars()[99]);
      barMore().focus();
      barMore().click();
      assert.equal(bars().length, 200);
      assert.equal(a.doc.activeElement.dataset.task, bars()[100].dataset.task);
      a.dialog.querySelector("#timeline-table").click();
      assert.equal(
        a.dialog.querySelectorAll("#timeline-data tbody tr").length,
        200,
      );
    } finally {
      a.close();
    }
  });
