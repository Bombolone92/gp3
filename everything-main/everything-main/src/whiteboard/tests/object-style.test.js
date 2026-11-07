import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { item, board, validateBoard } from "../src/model.js";
import {
  canCopyStyle,
  canPasteStyle,
  copyObjectStyle,
  readObjectStyle,
  objectStylePatch,
  applyObjectStyle,
} from "../src/object-style.js";
import { textStyle, autoHeightLayout } from "../src/text.js";
import { createCanvas } from "./canvas.js";
import { drawObject } from "../src/render.js";
import { SharedDocument } from "../src/collaboration/document.js";
const apply = (target, style) => {
  const patch = objectStylePatch(target, style);
  if (patch) applyObjectStyle(target, patch);
  return patch;
};

test("copied styles resolve defaults, use the first character, and contain no content or relationships", () => {
  const source = item("frame", 50, 70, {
    text: "Private content",
    groupId: "g",
    locked: true,
    textRuns: [
      {
        start: 0,
        end: 7,
        style: {
          italic: true,
          link: "https://example.com/",
          textColor: "#123456",
        },
      },
    ],
  });
  const style = copyObjectStyle(source);
  assert.deepEqual(style, {
    version: 1,
    text: {
      fontSize: 19,
      fontFamily: "dm-sans",
      textAlign: "left",
      bold: true,
      italic: true,
      underline: false,
      strike: false,
      textColor: "#123456",
      highlight: null,
    },
  });
  assert.equal(JSON.stringify(style).includes("Private"), false);
  assert.equal(JSON.stringify(style).includes("https"), false);
  assert.deepEqual(readObjectStyle(JSON.stringify(style)), style);
  assert.equal(
    canCopyStyle({
      type: "image",
      get src() {
        throw Error("Do not inspect media");
      },
    }),
    false,
  );
  assert.equal(copyObjectStyle({ type: "image" }), null);
  const explicit = copyObjectStyle(
    item("note", 0, 0, {
      bold: true,
      textRuns: [
        { start: 0, end: 1, style: { bold: false, highlight: false } },
      ],
      text: "x",
    }),
  );
  assert.equal(explicit.text.bold, false);
  assert.equal(explicit.text.highlight, null);
});

test("stored styles reject malformed or content-bearing packets before use", () => {
  for (const value of [
    null,
    "",
    "null",
    "{}",
    "[]",
    "x".repeat(2049),
    JSON.stringify({ version: 2, color: "#ffffff" }),
    JSON.stringify({ version: 1, color: "url(secret)" }),
    JSON.stringify({ version: 1, color: "#ffffff", textRuns: [] }),
    JSON.stringify({ version: 1, text: { fontSize: 101 } }),
    JSON.stringify({ version: 1, text: { fontSize: 20, bold: "yes" } }),
    JSON.stringify({
      version: 1,
      text: { fontSize: 20, link: "https://example.com" },
    }),
    JSON.stringify({ version: 1, text: { fontSize: 20, textColor: false } }),
    JSON.stringify({
      version: 1,
      text: { fontSize: 20, textAlign: "justify" },
    }),
    JSON.stringify({ version: 1, line: { lineWidth: 3 } }),
    '{"version":1,"color":"#ffffff","__proto__":{}}',
  ])
    assert.equal(readObjectStyle(value), null, String(value));
  for (const type of [
    "note",
    "text",
    "frame",
    "rect",
    "ellipse",
    "arrow",
    "pen",
    "table",
    "file",
    "link",
  ])
    assert.ok(
      readObjectStyle(JSON.stringify(copyObjectStyle(item(type, 0, 0)))),
    );
});

test("pasting text appearance retains labels, links, lists and geometry while clearing old visual overrides", () => {
  const source = item("text", 0, 0, {
    fontSize: 32,
    bold: true,
    italic: true,
    textAlign: "right",
  });
  const target = item("text", 100, 200, {
    text: "First\nSecond",
    w: 150,
    h: 200,
    autoHeight: true,
    textColor: "#ff0000",
    highlight: "#ffffff",
    underline: true,
    groupId: "g",
    parentId: "f",
    textBlocks: [{ start: 0, list: "number", indent: 0 }],
    textRuns: [
      {
        start: 0,
        end: 3,
        style: {
          bold: false,
          highlight: "#ff0000",
          link: "https://example.com/",
        },
      },
      {
        start: 3,
        end: 5,
        style: { italic: false, link: "https://example.com/" },
      },
    ],
  });
  const before = structuredClone(target),
    copied = copyObjectStyle(source);
  assert.ok(apply(target, copied));
  assert.equal(target.text, before.text);
  assert.deepEqual(target.textBlocks, before.textBlocks);
  for (const key of ["x", "y", "w", "h", "groupId", "parentId", "autoHeight"])
    assert.equal(target[key], before[key]);
  assert.deepEqual(target.textRuns, [
    { start: 0, end: 5, style: { link: "https://example.com/" } },
  ]);
  assert.equal(target.textColor, undefined);
  assert.equal(target.highlight, undefined);
  assert.equal(target.underline, false);
  assert.equal(target.bold, true);
  assert.equal(target.fontSize, 32);
  assert.equal(apply(target, copied), null);
  validateBoard({
    ...board(),
    items: [item("frame", 0, 0, { id: "f" }), target],
  });
  const ctx = createCanvas(300, 300).getContext("2d");
  assert.ok(
    autoHeightLayout(target, ctx).height > autoHeightLayout(before, ctx).height,
  );
});

test("style compatibility copies supported properties without replacing shape, media, cells or attachments", () => {
  const copied = copyObjectStyle(
    item("note", 0, 0, { color: "#123456", fontSize: 27, bold: true }),
  );
  for (const type of [
    "rect",
    "ellipse",
    "text",
    "frame",
    "table",
    "link",
    "file",
    "pen",
  ]) {
    const target = item(type, 10, 20, {
      text: "Keep",
      cells: [["A"]],
      url: "https://example.com/",
      fileName: "Keep.pdf",
      data: "unchanged",
      points: [
        [0, 0],
        [30, 20],
      ],
      shape: type === "rect" ? "diamond" : undefined,
    });
    const before = structuredClone(target);
    apply(target, copied);
    for (const k of [
      "text",
      "cells",
      "url",
      "fileName",
      "data",
      "points",
      "shape",
      "x",
      "y",
      "w",
      "h",
    ])
      assert.deepEqual(target[k], before[k], `${type}.${k}`);
    if (["text", "frame"].includes(type))
      assert.equal(target.color, before.color);
    else assert.equal(target.color, "#123456");
    if (["table", "file", "link"].includes(type)) {
      assert.equal(target.fontSize, 27);
      // A table takes the weight for all its cells; cards have none.
      assert.equal(target.bold, type === "table" ? true : undefined);
    }
    if (type === "pen") assert.equal(target.fontSize, undefined);
  }
  const image = {
    type: "image",
    src: "data",
    crop: { x: 0, y: 0, w: 0.5, h: 1 },
  };
  assert.equal(canPasteStyle(image, copied), false);
  assert.equal(apply(image, copied), null);
});

test("a table's weight, slant and alignment copy to tables and text, and not its other styles", () => {
  const source = item("table", 0, 0, {
    cells: [["A"]],
    fontSize: 22,
    fontFamily: "eb-garamond",
    bold: true,
    italic: true,
    textAlign: "right",
  });
  const copied = copyObjectStyle(source);
  assert.deepEqual(copied.text, {
    fontSize: 22,
    fontFamily: "eb-garamond",
    textAlign: "right",
    bold: true,
    italic: true,
  });
  assert.ok(readObjectStyle(JSON.stringify(copied)));
  const table = item("table", 0, 0, { cells: [["B"]] });
  assert.deepEqual(apply(table, copied), {
    fontSize: 22,
    fontFamily: "eb-garamond",
    textAlign: "right",
    bold: true,
    italic: true,
  });
  assert.equal(apply(table, copied), null);
  const note = item("note", 0, 0, { text: "Keep", underline: true });
  apply(note, copied);
  assert.equal(note.textAlign, "right");
  assert.equal(note.italic, true);
  assert.equal(note.underline, true);
  // A note's other styles do not reach a table.
  const styled = item("table", 0, 0, { cells: [["C"]] });
  apply(
    styled,
    copyObjectStyle(
      item("note", 0, 0, { underline: true, textColor: "#ff0000" }),
    ),
  );
  assert.equal(styled.underline, undefined);
  assert.equal(styled.textColor, undefined);
  assert.equal(styled.textAlign, undefined, "already aligned left");
  validateBoard({ ...board(), items: [table, note, styled] });
});

test("connector style copies path, stroke and caps without changing endpoint attachments or route direction", () => {
  const source = item("arrow", 0, 0, {
    lineType: "curved",
    lineStyle: "dotted",
    lineWidth: 7,
    startCap: "circle",
    endCap: "none",
    color: "#224466",
  });
  const target = item("arrow", 20, 30, {
    w: -200,
    h: 50,
    startId: "a",
    endId: "b",
    routeAxis: "y",
    text: "Flow",
  });
  apply(target, copyObjectStyle(source));
  for (const key of [
    "lineType",
    "lineStyle",
    "lineWidth",
    "startCap",
    "endCap",
    "color",
  ])
    assert.equal(target[key], source[key]);
  assert.equal(target.startId, "a");
  assert.equal(target.endId, "b");
  assert.equal(target.routeAxis, "y");
  assert.deepEqual(
    [target.x, target.y, target.w, target.h],
    [20, 30, -200, 50],
  );
  const plain = copyObjectStyle(item("arrow", 0, 0));
  apply(target, plain);
  assert.equal(target.lineType, "straight");
  assert.equal(target.endCap, "arrow");
  assert.equal(apply(target, plain), null);
});

test("pasted appearance renders its actual color and unchanged styles need no text measurement across 5000 objects", () => {
  const canvas = createCanvas(200, 200),
    ctx = canvas.getContext("2d");
  const target = item("note", 0, 0, {
    w: 190,
    h: 160,
    text: "Note",
    autoFontSize: false,
  });
  const copied = copyObjectStyle(
    item("note", 0, 0, {
      color: "#123456",
      autoFontSize: false,
      bold: true,
      fontSize: 30,
    }),
  );
  apply(target, copied);
  drawObject(ctx, target, "#30342f");
  assert.deepEqual([...ctx.getImageData(10, 10, 1, 1).data], [18, 52, 86, 255]);
  let reads = 0;
  const measured = ctx.measureText.bind(ctx);
  ctx.measureText = (s) => {
    reads++;
    return measured(s);
  };
  const targets = Array.from({ length: 5000 }, (_, n) => ({
    ...target,
    id: String(n),
    x: n * 200,
  }));
  for (const t of targets) assert.equal(apply(t, copied), null);
  assert.equal(reads, 0);
});

test("shared style paste and undo preserve concurrent text and another collaborator's geometry", () => {
  const b = board(),
    target = item("text", 0, 0, {
      text: "Guide",
      textRuns: [
        {
          start: 0,
          end: 5,
          style: { link: "https://example.com/", italic: true },
        },
      ],
    });
  b.items = [target];
  const a = new SharedDocument();
  a.commit(b);
  a.undo.clear();
  const c = new SharedDocument(Y.encodeStateAsUpdate(a.doc));
  const left = a.snapshot(),
    right = c.snapshot();
  apply(
    left.items[0],
    copyObjectStyle(item("text", 0, 0, { bold: true, fontSize: 40 })),
  );
  a.commit(left);
  right.items[0].text = "Guide later";
  right.items[0].x = 77;
  c.commit(right);
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(c.doc), "remote");
  Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(a.doc), "remote");
  assert.equal(a.snapshot().items[0].text, "Guide later");
  assert.equal(c.snapshot().items[0].bold, true);
  a.undo.undo();
  Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(a.doc), "remote");
  const result = c.snapshot().items[0];
  assert.equal(result.text, "Guide later");
  assert.equal(result.x, 77);
  assert.equal(result.bold, undefined);
  assert.equal(result.textRuns[0].style.link, "https://example.com/");
  assert.equal(result.textRuns[0].style.italic, true);
  a.doc.destroy();
  c.doc.destroy();
});

test("a shape's border copies to other shapes with an outline, and not to lines, notes or bare controls", () => {
  const source = item("rect", 0, 0, {
    color: "#ffffff",
    lineStyle: "dashed",
    lineWidth: 4,
  });
  const style = copyObjectStyle(source);
  assert.deepEqual(style.border, { lineStyle: "dashed", lineWidth: 4 });
  assert.deepEqual(readObjectStyle(JSON.stringify(style)), style);
  // The usual border is copied too, so pasting it restores a plain one.
  assert.deepEqual(copyObjectStyle(item("ellipse", 0, 0)).border, {
    lineStyle: "solid",
    lineWidth: 1,
  });
  for (const border of [
    { lineStyle: "dashed" },
    { lineStyle: "wavy", lineWidth: 2 },
    { lineStyle: "solid", lineWidth: 13 },
    { lineStyle: "solid", lineWidth: 2, color: "#000000" },
  ])
    assert.equal(
      readObjectStyle(JSON.stringify({ version: 1, border })),
      null,
      JSON.stringify(border),
    );
  for (const target of [
    item("ellipse", 0, 0),
    item("rect", 0, 0, { shape: "diamond" }),
    item("rect", 0, 0, { shape: "browser" }),
  ]) {
    apply(target, style);
    assert.equal(target.lineStyle, "dashed", target.shape || target.type);
    assert.equal(target.lineWidth, 4);
    // Pasting the usual border clears the fields instead of storing them.
    apply(target, copyObjectStyle(item("rect", 0, 0)));
    assert.equal("lineStyle" in target, false);
    assert.equal("lineWidth" in target, false);
    assert.equal(apply(target, copyObjectStyle(item("rect", 0, 0))), null);
  }
  const line = item("arrow", 0, 0, { w: 100, h: 0 });
  const note = item("note", 0, 0);
  const checkbox = item("rect", 0, 0, { shape: "wf-checkbox" });
  for (const target of [line, note, checkbox]) {
    apply(target, style);
    assert.equal(target.lineStyle, undefined, target.shape || target.type);
    assert.equal(target.lineWidth, undefined);
  }
  assert.equal(copyObjectStyle(checkbox).border, undefined);
  // A line's stroke stays with lines.
  const shape = item("rect", 0, 0);
  apply(
    shape,
    copyObjectStyle(item("arrow", 0, 0, { lineStyle: "dotted", lineWidth: 6 })),
  );
  assert.equal(shape.lineStyle, undefined);
});
