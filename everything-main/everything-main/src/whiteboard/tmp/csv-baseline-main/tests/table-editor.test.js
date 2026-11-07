import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { tableLanguagePatch } from "../src/table-language.js";
import { createTableEditor } from "../src/table-editor.js";

function setup() {
  const dom = new JSDOM('<div><canvas tabindex="0"></canvas></div>', {
    url: "https://whiteboard.test",
  });
  const previous = Object.fromEntries(
    ["document", "localStorage", "NodeFilter"].map((k) => [k, globalThis[k]]),
  );
  for (const k of Object.keys(previous)) globalThis[k] = dom.window[k];
  const s = {
    board: board(),
    view: { x: 100, y: 100, z: 1 },
    readOnly: false,
    writes: 0,
    fail: false,
  };
  const table = item("table", 0, 0, {
    w: 300,
    h: 180,
    cells: [
      ["Head", "Other"],
      ["Original", "Stay"],
    ],
  });
  s.board.items = [table];
  const doc = dom.window.document;
  const ui = createTableEditor({
    state: () => s,
    canvas: () => doc.querySelector("canvas"),
    selected: () => true,
    writable: (i) => !!i && !s.readOnly && !i.locked,
    prepare() {},
    reveal() {},
    toast() {},
    draw: () => ui.render(),
    resize: (i, patch) => {
      s.writes++;
      Object.assign(i, patch);
      ui.render();
    },
    change: (i, cells, structure, languages) => {
      if (s.fail) throw Error("Save failed");
      s.writes++;
      Object.assign(i, tableLanguagePatch(i, cells, structure, languages));
      ui.render();
    },
  });
  return {
    s,
    table,
    ui,
    doc,
    w: dom.window,
    close() {
      ui.close(false);
      dom.window.close();
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    },
  };
}
test("table ranges can be selected with an extend button and separate clicks instead of dragging", () => {
  const a = setup();
  try {
    a.ui.open(a.table, { r: 0, c: 0 });
    const extend = a.doc.querySelector("#table-cell-extend");
    assert.ok(extend, "Range selection has a pointer alternative to dragging");
    extend.click();
    assert.equal(extend.getAttribute("aria-pressed"), "true");
    const e = { button: 0, pointerId: 1, preventDefault() {} };
    a.ui.down(e, { x: 225, y: 135 });
    a.ui.end();
    assert.match(
      a.doc.querySelector("#table-cell-position").textContent,
      /Rows 1–2 · Columns 1–2/,
    );
    assert.equal(a.s.writes, 0);
    a.doc.querySelector("#table-cell-clear").click();
    assert.deepEqual(a.table.cells, [
      ["", ""],
      ["", ""],
    ]);
    assert.equal(a.s.writes, 1);
    extend.click();
    assert.equal(extend.getAttribute("aria-pressed"), "false");
    a.ui.down(e, { x: 75, y: 45 });
    a.ui.end();
    assert.match(
      a.doc.querySelector("#table-cell-position").textContent,
      /Rows 1 · Columns 1$/,
    );
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(extend.disabled, false);
    extend.click();
    a.ui.down(e, { x: 225, y: 135 });
    a.ui.end();
    assert.match(
      a.doc.querySelector("#table-cell-position").textContent,
      /Rows 1–2 · Columns 1–2/,
    );
    assert.equal(a.doc.querySelector("#table-cell-clear").disabled, true);
    assert.equal(a.s.writes, 1);
  } finally {
    a.close();
  }
});

test("cell drafts retain typed text after remote changes, save failures and temporary access loss", () => {
  const a = setup();
  try {
    a.ui.open(a.table, { r: 1, c: 0 }, true);
    let input = a.doc.querySelector("#table-cell-input");
    assert.equal(input.style.width, "150px");
    assert.equal(input.style.height, "90px");
    input.value = "My unsaved edit";
    a.table.cells[1][0] = "Remote edit";
    a.ui.render();
    assert.equal(a.ui.finish(), false);
    assert.equal(a.s.writes, 0);
    a.doc.querySelector("#table-cell-extend").click();
    assert.equal(
      a.doc.querySelector("#table-cell-extend").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      a.doc.querySelector("#table-cell-input").value,
      "My unsaved edit",
    );
    a.ui.close();
    a.ui.open(a.table, { r: 1, c: 0 }, true);
    assert.equal(
      a.doc.querySelector("#table-cell-input").value,
      "My unsaved edit",
    );
    a.doc.querySelector("#table-cell-reset").click();
    input = a.doc.querySelector("#table-cell-input");
    assert.equal(input.value, "Remote edit");
    input.value = "Try again";
    a.s.fail = true;
    assert.equal(a.ui.finish(), false);
    assert.equal(a.doc.querySelector("#table-cell-input").value, "Try again");
    a.s.fail = false;
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(input.getAttribute("contenteditable"), "false");
    assert.equal(input.getAttribute("aria-readonly"), "true");
    assert.equal(a.ui.finish(), false);
    a.s.readOnly = false;
    a.ui.render();
    assert.equal(a.ui.finish(), true);
    assert.equal(a.table.cells[1][0], "Try again");
    assert.equal(a.s.writes, 1);
  } finally {
    a.close();
  }
});
test("cell navigation and range gestures have bounded DOM and do not inspect unrelated table content", () => {
  const a = setup();
  try {
    let reads = 0;
    for (let n = 1; n < 5000; n++) {
      const i = item("table", 0, 0);
      Object.defineProperty(i, "cells", {
        get() {
          reads++;
          throw Error("Unrelated table read");
        },
      });
      a.s.board.items.push(i);
    }
    a.ui.open(a.table);
    const count = a.doc.querySelectorAll("#table-editor *").length,
      grid = a.doc.querySelector('[role="grid"]');
    grid.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    grid.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.doc.querySelector('[role="gridcell"]').textContent, "Stay");
    a.ui.down({ shiftKey: false }, { x: 10, y: 10 });
    a.ui.move({ x: 250, y: 150 });
    a.ui.end(true);
    assert.equal(a.doc.querySelector('[role="gridcell"]').textContent, "Stay");
    const node = a.doc.querySelector(".table-cell-outline");
    for (let n = 0; n < 20; n++) {
      a.s.view.x++;
      a.ui.render();
    }
    assert.equal(a.doc.querySelectorAll("#table-editor *").length, count);
    assert.equal(a.doc.querySelector(".table-cell-outline"), node);
    assert.equal(reads, 0);
    assert.equal(a.s.writes, 0);
  } finally {
    a.close();
  }
});

test("failed range cuts preserve table data and oversized cell pastes are rejected", () => {
  const a = setup();
  try {
    a.ui.open(a.table);
    const dispatch = (type, data) => {
      const e = new a.w.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clipboardData", { value: data });
      a.doc.querySelector("canvas").dispatchEvent(e);
      return e;
    };
    assert.equal(
      dispatch("cut", {
        setData(type) {
          if (type === "text/html") throw Error("Clipboard unavailable");
        },
      }).defaultPrevented,
      true,
    );
    assert.equal(a.table.cells[0][0], "Head");
    assert.equal(a.s.writes, 0);
    dispatch("paste", {
      files: [],
      getData: (type) => (type === "text/plain" ? "X".repeat(2001) : ""),
    });
    assert.equal(a.s.writes, 0);
    assert.match(a.doc.querySelector("#table-cell-error").textContent, /2,000/);
  } finally {
    a.close();
  }
});

test("pastes with nothing for a cell leave the cells alone, and spreadsheet cells come before their picture", () => {
  const a = setup();
  try {
    a.ui.open(a.table, { r: 1, c: 0 });
    const dispatch = (data) => {
      const e = new a.w.Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clipboardData", { value: data });
      a.doc.querySelector("canvas").dispatchEvent(e);
      return e;
    };
    // A copied image or shape without text has empty plain text.
    const empty = dispatch({ files: [], getData: () => "" });
    assert.equal(empty.defaultPrevented, false, "the board pastes it");
    assert.equal(a.table.cells[1][0], "Original");
    assert.equal(a.s.writes, 0);
    const html = "<table><tr><td>X1</td><td>Y1</td></tr></table>";
    const sheet = dispatch({
      files: [{ name: "image.png", type: "image/png" }],
      getData: (type) =>
        type === "text/html" ? html : type === "text/plain" ? "X1\tY1" : "",
    });
    assert.equal(sheet.defaultPrevented, true);
    assert.deepEqual(a.table.cells[1], ["X1", "Y1"]);
    // Files alone are left to the board.
    const files = dispatch({
      files: [{ name: "image.png", type: "image/png" }],
      getData: () => "",
    });
    assert.equal(files.defaultPrevented, false);
    assert.equal(a.s.writes, 1);
  } finally {
    a.close();
  }
});

test("table border resizing previews privately, cancels safely, and keeps remote track edits", () => {
  const a = setup();
  try {
    a.ui.open(a.table);
    const begin = () =>
      a.ui.down(
        { button: 0, pointerId: 1, preventDefault() {} },
        { x: 150, y: 40 },
      );
    begin();
    a.ui.move({ x: 200, y: 40 });
    assert.equal(a.ui.preview().w, 350);
    assert.equal(a.table.w, 300);
    assert.equal(a.s.writes, 0);
    a.ui.end(true);
    assert.equal(a.ui.preview(), null);
    assert.equal(a.s.writes, 0);
    begin();
    a.ui.move({ x: 200, y: 40 });
    a.table.columnWidths = [150, 220];
    a.table.w = 370;
    a.ui.render();
    assert.deepEqual(a.ui.preview().columnWidths, [200, 220]);
    a.ui.end();
    assert.deepEqual(a.table.columnWidths, [200, 220]);
    assert.equal(a.s.writes, 1);
    for (const invalidate of [
      () => (a.s.readOnly = true),
      () => (a.table.locked = true),
      () => a.s.view.x++,
      () => a.table.x++,
      () => {
        a.table.columnWidths[0]++;
        a.table.w++;
      },
    ]) {
      const x = a.table.x + a.table.columnWidths[0];
      a.ui.down({ button: 0, pointerId: 1, preventDefault() {} }, { x, y: 40 });
      a.ui.move({ x: x + 40, y: 40 });
      invalidate();
      a.ui.end();
      assert.equal(a.s.writes, 1);
      a.s.readOnly = false;
      a.table.locked = false;
    }
  } finally {
    a.close();
  }
});

test("table resize handles isolate pointers and support keyboard and numeric range controls", () => {
  const a = setup();
  try {
    a.ui.open(a.table);
    const key = (value, shiftKey = false) =>
      a.doc.activeElement.dispatchEvent(
        new a.w.KeyboardEvent("keydown", {
          key: value,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    key("Tab", true);
    assert.equal(a.doc.activeElement.dataset.tableSize, "row:equal");
    a.ui.open(a.table, { r: 1, c: 1 });
    key("Tab");
    assert.equal(a.doc.activeElement.dataset.tableResize, "column");
    a.ui.open(a.table);
    const handle = a.doc.querySelector('[data-table-resize="column"]');
    const pointer = (type, id, x) => {
      const e = new a.w.MouseEvent(type, {
        button: 0,
        clientX: x,
        clientY: 80,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(e, "pointerId", { value: id });
      handle.dispatchEvent(e);
    };
    pointer("pointerdown", 1, 250);
    pointer("pointermove", 2, 350);
    pointer("pointerup", 2, 350);
    assert.equal(a.ui.preview(), null);
    pointer("pointermove", 1, 290);
    assert.equal(a.ui.preview().w, 340);
    pointer("pointercancel", 1, 290);
    assert.equal(a.s.writes, 0);
    handle.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.deepEqual(a.table.columnWidths, [160, 150]);
    const grid = a.doc.querySelector('[role="grid"]');
    grid.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const field = a.doc.querySelector("#table-column-size");
    assert.equal(field.value, "");
    field.value = "200";
    field.dispatchEvent(new a.w.Event("change"));
    assert.deepEqual(a.table.columnWidths, [200, 200]);
    const writes = a.s.writes;
    field.value = "0";
    field.dispatchEvent(new a.w.Event("change"));
    assert.equal(a.s.writes, writes);
    assert.match(a.doc.querySelector("#table-cell-error").textContent, /valid/);
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(handle.hidden, true);
    assert.equal(field.disabled, true);
  } finally {
    a.close();
  }
});

test("numeric table sizing keeps focus for continued editing and invalid values", () => {
  const a = setup();
  try {
    a.ui.open(a.table);
    for (const axis of ["column", "row"]) {
      const field = a.doc.querySelector(`#table-${axis}-size`);
      field.focus();
      field.value = "200";
      field.dispatchEvent(new a.w.Event("change"));
      assert.equal(a.doc.activeElement, field);
      assert.equal(
        a.table[axis === "column" ? "columnWidths" : "rowHeights"][0],
        200,
      );
      const writes = a.s.writes;
      field.value = "0";
      field.dispatchEvent(new a.w.Event("change"));
      assert.equal(a.doc.activeElement, field);
      assert.equal(
        field.value,
        "0",
        "Keep the invalid value available to correct",
      );
      assert.equal(a.s.writes, writes);
    }
  } finally {
    a.close();
  }
});

test("a failed keyboard save keeps the table cell draft focused for correction", () => {
  const a = setup();
  try {
    a.ui.open(a.table, { r: 1, c: 0 }, true);
    const input = a.doc.querySelector("#table-cell-input");
    input.value = "Keep typing";
    a.s.fail = true;
    const enter = new a.w.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(a.doc.activeElement, input);
    assert.equal(input.value, "Keep typing");
    assert.equal(a.table.cells[1][0], "Original");
    assert.equal(a.s.writes, 0);
    a.s.fail = false;
    input.value = "Corrected draft";
    input.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.table.cells[1][0], "Corrected draft");
    assert.equal(a.doc.activeElement, a.doc.querySelector("canvas"));
    assert.equal(a.s.writes, 1);
  } finally {
    a.close();
  }
});

test("Tab saves an edited boundary cell and moves focus to table controls", () => {
  const a = setup();
  try {
    for (const shiftKey of [false, true]) {
      const cell = shiftKey ? { r: 0, c: 0 } : { r: 1, c: 1 };
      a.ui.open(a.table, cell, true);
      const input = a.doc.querySelector("#table-cell-input");
      input.value = shiftKey ? "First saved" : "Last saved";
      input.dispatchEvent(
        new a.w.KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
      assert.equal(a.doc.querySelector("#table-cell-input"), null);
      assert.equal(a.table.cells[cell.r][cell.c], input.value);
      assert.equal(
        a.doc.activeElement,
        a.doc.querySelector(
          shiftKey
            ? '[data-table-size="row:equal"]'
            : '[data-table-resize="column"]',
        ),
      );
    }
    assert.equal(a.s.writes, 2);
    a.ui.open(a.table, { r: 1, c: 1 }, true);
    const draft = a.doc.querySelector("#table-cell-input");
    draft.value = "Cannot save yet";
    a.s.fail = true;
    draft.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.doc.activeElement, draft);
    assert.equal(draft.value, "Cannot save yet");
    assert.equal(a.table.cells[1][1], "Last saved");
    assert.equal(a.s.writes, 2);
  } finally {
    a.close();
  }
});

test("language-only cell drafts survive remote formatting and failed saves without overwriting the latest cell", () => {
  const a = setup();
  const field = () => a.doc.querySelector("#table-cell-input");
  const apply = (tag, scope = "field") => {
    a.doc.querySelector("#table-cell-language").click();
    a.doc.querySelector("#table-cell-input-language-scope").value = scope;
    a.doc.querySelector("#table-cell-input-language-tag").value = tag;
    a.doc.querySelector("#table-cell-input-language-save").click();
  };
  try {
    a.table.lang = "en-CA";
    a.table.cells[1][0] = "Bonjour à tous.";
    a.table.cellLanguages = { "1,0": { lang: "fr-CA" } };
    a.ui.open(a.table, { r: 1, c: 0 }, true);
    field().setSelectionRange(0, 7);
    apply("fr-BE", "text");
    assert.equal(
      field().querySelector('[lang="fr-BE"]').textContent,
      "Bonjour",
    );
    a.table.cellLanguages["1,0"].lang = "fr-FR";
    a.ui.render();
    assert.equal(a.ui.finish(), false);
    assert.equal(a.s.writes, 0);
    assert.equal(a.table.cellLanguages["1,0"].lang, "fr-FR");
    a.ui.close();
    a.ui.open(a.table, { r: 1, c: 0 }, true);
    assert.equal(
      field().querySelector('[lang="fr-BE"]').textContent,
      "Bonjour",
    );
    assert.equal(a.ui.finish(), false);
    a.doc.querySelector("#table-cell-reset").click();
    assert.equal(field().lang, "fr-FR");
    assert.deepEqual(field().textRuns, []);
    field().setSelectionRange(0, 0);
    apply("fr-CH");
    a.s.fail = true;
    field().focus();
    assert.equal(a.ui.finish(), false);
    assert.equal(a.doc.activeElement, field());
    assert.equal(field().lang, "fr-CH");
    assert.equal(a.table.cellLanguages["1,0"].lang, "fr-FR");
    // The restored disclosure still operates on this retained draft after the
    // failed save, rather than creating a second editor or losing its closure.
    field().setSelectionRange(0, 0);
    apply("fr-BE");
    assert.equal(a.doc.querySelectorAll("#table-cell-input").length, 1);
    assert.equal(field().lang, "fr-BE");
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(a.ui.finish(), false);
    assert.equal(a.s.writes, 0);
    a.s.readOnly = false;
    a.s.fail = false;
    a.ui.render();
    assert.equal(a.ui.finish(), true);
    assert.equal(a.table.cellLanguages["1,0"].lang, "fr-BE");
    assert.equal(a.table.cells[1][0], "Bonjour à tous.");
    assert.equal(a.s.writes, 1);
  } finally {
    a.close();
  }
});
