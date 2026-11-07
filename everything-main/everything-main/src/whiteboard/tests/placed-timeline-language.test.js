import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, validateBoard } from "../src/model.js";
import { collectTasks } from "../src/planning/tasks.js";
import { timelineItems } from "../src/planning/timeline.js";
import { language, setLanguage } from "../src/i18n.js";
import { validateTextRuns } from "../src/rich-text.js";
import { objectNameHTML } from "../src/accessibility/object-content.js";
import { SharedDocument } from "../src/collaboration/document.js";
import {
  clipboardFormats,
  readFragment,
  CLIPBOARD_TYPE,
} from "../src/transfer.js";

const environment = new JSDOM('<html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  }),
  previousDocument = globalThis.document,
  previousStorage = globalThis.localStorage;
test.before(() => {
  globalThis.document = environment.window.document;
  globalThis.localStorage = environment.window.localStorage;
});
test.after(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = previousStorage;
  environment.window.close();
});

const TODAY = "2026-09-30";
function plan() {
  const b = board("Language snapshots"),
    frameText =
      '  Veuillez  discuter.\n Read first. <img id="timeline-injection"> ',
    title = '  Veuillez  choisir.\n Read first. <img id="timeline-injection"> ',
    frame = item("frame", 0, 0, {
      text: frameText,
      lang: "fr-ca",
      w: 800,
      h: 600,
      textRuns: [
        {
          start: frameText.indexOf("Read"),
          end: frameText.indexOf(" <img"),
          style: { lang: "en-ca", bold: true },
        },
      ],
    }),
    task = item("note", 30, 70, {
      text: title,
      lang: "fr-ca",
      parentId: frame.id,
      textRuns: [
        {
          start: title.indexOf("Read"),
          end: title.indexOf(" <img"),
          style: { lang: "en-ca", italic: true },
        },
      ],
      task: { status: "in-progress", start: "2026-10-01", due: "2026-10-02" },
    });
  b.items = [frame, task];
  return { b, frame, task };
}
const placed = (b, options = {}) =>
  timelineItems(b, collectTasks(b, { today: TODAY }), {
    today: TODAY,
    groupBy: "frame",
    ...options,
  });
const bySource = (items, task) =>
  items.find((i) => i.objectLink?.objectId === task.id);

test("placed task and frame captions capture normalized language-only declarations with independent status context", () => {
  const previous = language;
  setLanguage("en");
  try {
    const { b, frame, task } = plan(),
      source = JSON.stringify(b),
      { items } = placed(b),
      bar = bySource(items, task),
      lane = items.find((i) => i.type === "text" && i.text === frame.text);
    assert.equal(JSON.stringify(b), source);
    assert.equal(bar.lang, "fr-CA");
    assert.equal(lane.lang, "fr-CA");
    const normalized = task.text.replace(/\s+/g, " ").trim();
    assert.equal(bar.text, normalized + " (In progress)");
    assert.deepEqual(bar.textRuns, [
      {
        start: normalized.indexOf("Read"),
        end: normalized.indexOf(" <img"),
        style: { lang: "en-CA" },
      },
      { start: normalized.length, end: bar.text.length, style: { lang: "en" } },
    ]);
    assert.deepEqual(lane.textRuns, [
      {
        start: frame.text.indexOf("Read"),
        end: frame.text.indexOf(" <img"),
        style: { lang: "en-CA" },
      },
    ]);
    for (const i of items) validateTextRuns(i.text, i.textRuns);
    validateBoard({ ...b, items: [...b.items, ...items] });
    setLanguage("fr");
    const dom = new JSDOM(
      `<html lang="fr"><body>${objectNameHTML(bar)}${objectNameHTML(lane)}</body></html>`,
    );
    try {
      assert.equal(
        dom.window.document.querySelector('[lang="en"]').textContent,
        " (In progress)",
      );
      assert.equal(
        dom.window.document.querySelector('[lang="en-CA"]').textContent,
        "Read first.",
      );
      assert.equal(
        dom.window.document.querySelector("#timeline-injection"),
        null,
      );
      assert.equal(
        dom.window.document.querySelector('[lang="fr-CA"]').textContent,
        bar.text,
      );
    } finally {
      dom.window.close();
    }
  } finally {
    setLanguage(previous);
  }
});

test("placed captions clip ranges and Unicode characters at the display cap without applying source tags to status text", () => {
  const previous = language;
  setLanguage("en");
  try {
    const { b, frame, task } = plan();
    task.text = "a".repeat(198) + "😀 Bonjour à tous.";
    task.lang = "en-CA";
    task.textRuns = [
      {
        start: 190,
        end: task.text.length,
        style: { lang: "fr-CA", bold: true },
      },
    ];
    frame.text = "x".repeat(197) + "  Read this instruction.";
    frame.lang = "es";
    frame.textRuns = [
      { start: 195, end: frame.text.length, style: { lang: "en-CA" } },
    ];
    const { items } = placed(b),
      bar = bySource(items, task),
      lane = items.find((i) => i.type === "text" && i.lang === "es");
    assert.equal(bar.text, "a".repeat(198) + "… (In progress)");
    assert.equal(lane.text, "x".repeat(197) + "…");
    assert.equal(bar.text.isWellFormed(), true);
    assert.equal(lane.text.isWellFormed(), true);
    assert.deepEqual(bar.textRuns, [
      { start: 190, end: 198, style: { lang: "fr-CA" } },
      { start: 199, end: bar.text.length, style: { lang: "en" } },
    ]);
    assert.deepEqual(lane.textRuns, [
      { start: 195, end: 197, style: { lang: "en-CA" } },
    ]);
    validateBoard({ ...b, items: [...b.items, ...items] });
    task.textRuns = [
      {
        start: task.text.indexOf("Bonjour"),
        end: task.text.length,
        style: { lang: "fr" },
      },
    ];
    assert.deepEqual(bySource(placed(b).items, task).textRuns, [
      { start: 199, end: bar.text.length, style: { lang: "en" } },
    ]);
    // The exact cap retains a complete final character without an ellipsis.
    task.text = "a".repeat(198) + "😀";
    task.textRuns = [{ start: 198, end: 200, style: { lang: "fr" } }];
    const exact = bySource(placed(b).items, task);
    assert.equal(exact.text, task.text + " (In progress)");
    validateTextRuns(exact.text, exact.textRuns);
  } finally {
    setLanguage(previous);
  }
});

test("generated and unknown title/lane contexts remain distinct, with generating language retained on UI labels", () => {
  const previous = language;
  setLanguage("fr");
  try {
    const b = board("Contexts"),
      frame = item("frame", 0, 0, { text: "", lang: "es" }),
      make = (text) =>
        item("note", 30, 70, {
          text,
          parentId: frame.id,
          task: { status: "todo", due: TODAY },
        }),
      blank = make(" \t "),
      literal = make("Untitled task"),
      unknown = make("Please keep this instruction."),
      partial = make("Begin. Bonjour. End.");
    blank.lang = "en";
    literal.lang = "en-CA";
    partial.textRuns = [{ start: 7, end: 15, style: { lang: "fr-CA" } }];
    b.items = [frame, blank, literal, unknown, partial];
    const { items, frame: generatedFrame } = placed(b);
    assert.equal(generatedFrame.lang, "fr");
    assert.equal(bySource(items, blank).lang, "fr");
    assert.equal(bySource(items, blank).text, "Tâche sans titre (À faire)");
    assert.equal(bySource(items, literal).lang, "en-CA");
    const old = bySource(items, unknown);
    assert.equal(old.lang, undefined);
    assert.deepEqual(old.textRuns, [
      {
        start: unknown.text.length,
        end: old.text.length,
        style: { lang: "fr" },
      },
    ]);
    const mixed = bySource(items, partial);
    assert.equal(mixed.lang, undefined);
    assert.deepEqual(mixed.textRuns[0], partial.textRuns[0]);
    assert.equal(
      items.find((i) => i.type === "text" && i.text === "Cadre").lang,
      "fr",
    );
    assert.equal(
      items.find((i) => i.type === "text" && i.text === "Aujourd’hui").lang,
      "fr",
    );
    for (const groupBy of ["assignee", "status"]) {
      const group = placed(b, { groupBy });
      const labels = group.items.filter(
        (i) => i.type === "text" && i.bold && i.fontSize === 14,
      );
      assert.ok(labels.length);
      assert.ok(labels.every((i) => i.lang === "fr"));
    }
    unknown.task.assignee = { id: "person", name: "Unknown assignee name" };
    const names = placed(b, { groupBy: "assignee" }).items;
    assert.equal(
      names.find((i) => i.text === "Unknown assignee name").lang,
      undefined,
    );
    const custom = placed(b, {
      title: "Unknown custom title",
      language: "en-CA",
    });
    assert.equal(custom.frame.lang, undefined);
    const ticks = custom.items.filter((i) => i.type === "text" && !i.bold);
    assert.ok(ticks.length);
    assert.ok(ticks.every((i) => i.lang === "en-CA"));
    for (const dateContext of ["fr", "fr-CA", ["en-CA"]]) {
      const dates = placed(b, { language: dateContext }).items.filter(
        (i) => i.type === "text" && !i.bold,
      );
      const french = dateContext === "fr";
      assert.equal(dates[0].text, french ? "29 sept." : "Sep 29");
      assert.ok(dates.every((i) => i.lang === (french ? "fr-CA" : "en-CA")));
      validateBoard({
        ...b,
        items: [...b.items, ...placed(b, { language: dateContext }).items],
      });
    }
  } finally {
    setLanguage(previous);
  }
});

test("placed snapshots persist independently of source edits, deletion, shared serialization and clipboard HTML", () => {
  const previous = language;
  setLanguage("en");
  const shared = new SharedDocument();
  let reopened;
  try {
    const { b, frame, task } = plan(),
      result = placed(b),
      ids = new Set(result.items.map((i) => i.id));
    const saved = structuredClone(result.items);
    b.items.push(...result.items);
    shared.commit(b);
    reopened = new SharedDocument(shared.update());
    assert.deepEqual(
      reopened.snapshot().items.filter((i) => ids.has(i.id)),
      saved,
    );
    task.text = "Contenido cambiado.";
    task.lang = "es";
    delete task.textRuns;
    frame.text = "New frame title.";
    frame.lang = "en";
    delete frame.textRuns;
    shared.commit(b);
    assert.deepEqual(
      shared.snapshot().items.filter((i) => ids.has(i.id)),
      saved,
    );
    b.items = b.items.filter((i) => i !== task && i !== frame);
    shared.commit(b);
    const current = shared.snapshot();
    validateBoard(current);
    assert.deepEqual(
      current.items.filter((i) => ids.has(i.id)),
      saved,
    );
    const exported = JSON.parse(JSON.stringify(current));
    validateBoard(exported);
    assert.deepEqual(exported.items, saved);
    const copy = clipboardFormats(current.items);
    // Object clipboard HTML encodes the board fragment; the actual reader
    // restores its declarations from that metadata rather than nested spans.
    for (const format of [CLIPBOARD_TYPE, "text/html"]) {
      const restored = readFragment({
        getData: (type) => (type === format ? copy[format] : ""),
      });
      assert.deepEqual(restored, saved);
    }
    assert.doesNotMatch(copy["text/html"], /<img id="timeline-injection">/);
  } finally {
    reopened?.destroy();
    shared.destroy();
    setLanguage(previous);
  }
});
