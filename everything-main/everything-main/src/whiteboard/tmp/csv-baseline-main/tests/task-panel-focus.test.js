import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { createTaskPanel } from "../src/planning/task-panel.js";

function setup(withTask = true, people = Promise.resolve(null)) {
  const dom = new JSDOM(
    '<div><canvas id="canvas" tabindex="0"></canvas></div>',
    { url: "https://whiteboard.test", pretendToBeVisual: true },
  );
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const b = board("Tasks"),
    note = item("note", 0, 0, {
      text: "Task",
      ...(withTask
        ? { task: { assignee: null, start: null, due: null, status: "todo" } }
        : {}),
    }),
    state = { writable: true, writes: 0 };
  b.items = [note];
  const ui = createTaskPanel({
    board: () => b,
    selection: () => new Set([note.id]),
    canvas: () => document.querySelector("#canvas"),
    canEdit: () => state.writable,
    readOnly: () => !state.writable,
    mutate(fn) {
      state.writes++;
      fn();
      ui.render();
    },
    toast() {},
    announce() {},
    prepare() {},
    people: () => people,
    jira: { available: () => false },
  });
  ui.open();
  return {
    ui,
    note,
    state,
    doc: dom.window.document,
    window: dom.window,
    close() {
      ui.close();
      dom.window.close();
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

test("losing task edit access moves focus off disabled fields and actions", () => {
  for (const withTask of [true, false]) {
    const a = setup(withTask);
    try {
      const field = a.doc.querySelector(
          withTask ? "#task-start" : "#task-make",
        ),
        close = a.doc.querySelector("#task-close");
      field.focus();
      if (withTask) field.value = "2026-10-02";
      a.state.writable = false;
      a.ui.render();
      assert.equal(field.disabled, true);
      assert.equal(a.doc.activeElement, close);
      if (withTask) {
        assert.equal(field.value, "2026-10-02");
        field.dispatchEvent(new a.window.Event("change"));
        assert.equal(a.note.task.start, null);
      } else field.dispatchEvent(new a.window.Event("click"));
      assert.equal(a.state.writes, 0);
      a.state.writable = true;
      a.ui.render();
      assert.equal(a.doc.activeElement, close);
      field.focus();
      a.ui.render();
      assert.equal(a.doc.activeElement, field);
    } finally {
      a.close();
    }
  }
});

test("a member list arriving keeps the assignee field and its pending text usable", async () => {
  let resolvePeople;
  const pending = new Promise((resolve) => (resolvePeople = resolve)),
    a = setup(true, pending);
  try {
    const field = a.doc.querySelector("#task-assignee-text"),
      select = a.doc.querySelector("#task-assignee"),
      close = a.doc.querySelector("#task-close");
    field.focus();
    field.value = "Pending assignee";
    resolvePeople([{ id: "one", name: "Member", member: true }]);
    await pending;
    await Promise.resolve();
    assert.equal(a.doc.activeElement, field);
    assert.equal(field.closest("[hidden]"), null);
    assert.equal(field.value, "Pending assignee");
    assert.ok(select.closest("[hidden]"));
    assert.equal(a.state.writes, 0);
    field.dispatchEvent(new a.window.Event("change"));
    assert.deepEqual(a.note.task.assignee, {
      id: "name:pending assignee",
      name: "Pending assignee",
    });
    assert.equal(a.state.writes, 1);
    assert.equal(a.doc.activeElement, field);
    close.focus();
    await Promise.resolve();
    assert.equal(select.closest("[hidden]"), null);
    assert.ok(field.closest("[hidden]"));
    assert.equal(select.value, "name:pending assignee");
    assert.ok([...select.options].some((o) => o.textContent === "Member"));
    assert.equal(a.doc.activeElement, close);
  } finally {
    a.close();
  }
});

test("remote task detail removal moves focus off hidden fields without recreating tasks", () => {
  for (const writable of [true, false]) {
    const a = setup();
    try {
      const field = a.doc.querySelector("#task-due"),
        make = a.doc.querySelector("#task-make"),
        close = a.doc.querySelector("#task-close");
      field.focus();
      field.value = "2026-10-03";
      delete a.note.task;
      a.state.writable = writable;
      a.ui.render();
      assert.ok(field.closest("[hidden]"));
      assert.equal(a.doc.activeElement, writable ? make : close);
      assert.equal(a.note.task, undefined);
      assert.equal(a.state.writes, 0);
      if (writable) {
        make.click();
        assert.equal(a.state.writes, 1);
        assert.equal(a.note.task.status, "todo");
        assert.equal(a.doc.activeElement, a.doc.querySelector("#task-status"));
        const remove = a.doc.querySelector("#task-remove");
        remove.focus();
        remove.click();
        assert.equal(a.doc.activeElement, make);
        assert.equal(a.note.task, undefined);
        assert.equal(a.state.writes, 2);
      }
    } finally {
      a.close();
    }
  }
});
