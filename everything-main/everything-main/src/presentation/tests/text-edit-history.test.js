import { describe, it, expect } from "vitest";
import { textEditHistory } from "../src/text-edit-history.js";
const replay = (initial, edits) =>
  edits.reduce(
    (s, e) => s.slice(0, e.start) + e.text + s.slice(e.end),
    initial,
  );
describe("native textarea edit history", () => {
  it("records the actual caret among identical characters", () => {
    const h = textEditHistory("aaaa");
    h.input("aaaaa", { start: 1, end: 1, type: "insertText" });
    expect(h.edits()).toEqual([{ start: 1, end: 1, text: "a" }]);
  });
  it.each([
    [
      "aaaa",
      "aaa",
      { start: 2, end: 2, afterStart: 1, type: "deleteContentBackward" },
      1,
      2,
    ],
    [
      "abc def",
      "abc ",
      { start: 7, end: 7, afterStart: 4, type: "deleteWordBackward" },
      4,
      7,
    ],
    [
      "aaaa",
      "aaa",
      { start: 1, end: 1, afterStart: 1, type: "deleteContentForward" },
      1,
      2,
    ],
    [
      "abcdef",
      "abef",
      { start: 2, end: 4, afterStart: 2, type: "deleteByCut" },
      2,
      4,
    ],
    ["A😀B", "AXB", { start: 1, end: 3, type: "insertText" }, 1, 3],
  ])(
    "keeps native deletion and selection ranges %s → %s",
    (before, next, hint, start, end) => {
      const h = textEditHistory(before);
      h.input(next, hint);
      expect(h.edits()[0]).toMatchObject({ start, end });
      expect(replay(before, h.edits())).toBe(next);
    },
  );
  it("records separated changes without selecting the unchanged middle", () => {
    const initial = "Title\nBody 1 line",
      h = textEditHistory(initial);
    h.input("Title revised\nBody 1 line", {
      start: 5,
      end: 5,
      type: "insertText",
    });
    h.input("Title revised\nBody 1 line end", {
      start: 25,
      end: 25,
      type: "insertText",
    });
    expect(h.edits()).toHaveLength(2);
    expect(h.edits()[0]).toMatchObject({ start: 5, end: 5 });
    expect(h.edits()[1]).toMatchObject({ start: 25, end: 25 });
  });
  it("handles whole-control updates and composed Unicode without splitting surrogate pairs", () => {
    const initial = "A😀B",
      h = textEditHistory(initial);
    h.input("A😄B");
    expect(h.edits()).toEqual([{ start: 1, end: 3, text: "😄" }]);
    h.input("A一B", { start: 3, end: 3, type: "insertCompositionText" });
    expect(replay(initial, h.edits())).toBe("A一B");
  });
  it("restores the original native history on undo and redo, then branches after undo", () => {
    const h = textEditHistory("Field 1");
    h.input("Field X", { start: 6, end: 7, type: "insertText" });
    const changed = h.edits();
    h.input("Field 1", { type: "historyUndo" });
    expect(h.edits()).toEqual([]);
    h.input("Field X", { type: "historyRedo" });
    expect(h.edits()).toEqual(changed);
    h.input("Field 1", { type: "historyUndo" });
    h.input("Field 1 end", { start: 7, end: 7, type: "insertText" });
    expect(h.edits()).toEqual([{ start: 7, end: 7, text: " end" }]);
  });
  it("records Shift+Enter as a soft line and ignores unchanged input", () => {
    const h = textEditHistory("A");
    h.input("A\n", { start: 1, end: 1, type: "insertLineBreak", line: true });
    expect(h.edits()[0].breakKind).toBe("line");
    h.input("A\n");
    expect(h.edits()).toHaveLength(1);
  });
  it("replays a long typing session from shared edit nodes", () => {
    const initial = "a".repeat(10000),
      h = textEditHistory(initial);
    let value = initial;
    for (let i = 0; i < 200; i++) {
      const end = value.length;
      value += "X";
      h.input(value, { start: end, end, type: "insertText" });
    }
    expect(replay(initial, h.edits())).toBe(value);
    expect(h.edits()).toHaveLength(1);
    h.input(initial, { type: "historyUndo" });
    expect(h.edits()).toEqual([]);
  });
});
