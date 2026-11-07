import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import { openTasksDialog } from "../src/planning/tasks-dialog.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner, editor } from "./collaboration-helpers.js";
import {
  collectTasks,
  groupTasks,
  exportTasksCSV,
} from "../src/planning/tasks.js";
import { timelineModel } from "../src/planning/timeline.js";
import { validateTextRuns } from "../src/rich-text.js";

function framePlan() {
  const b = board("Task frame labels"),
    text = '  Veuillez  discuter.\n Read first. <img id="frame-injection"> ';
  const frame = item("frame", 0, 0, {
      id: 'frame " [ \\ : id',
      text,
      lang: "fr-ca",
      textRuns: [
        {
          start: text.indexOf("Read"),
          end: text.indexOf(" <img"),
          style: { lang: "en-ca", bold: true },
        },
      ],
      w: 800,
      h: 600,
    }),
    empty = item("frame", 1000, 0, { text: "", lang: "es" }),
    literal = item("frame", 2000, 0, { text: "Frame", lang: "en-CA" }),
    task = (text, parentId) =>
      item("note", 50, 50, {
        text,
        parentId,
        task: { status: "todo", start: "2026-10-01", due: "2026-10-02" },
      });
  b.items = [
    frame,
    empty,
    literal,
    task("First instruction.", frame.id),
    task("Second instruction.", empty.id),
    task("Third instruction.", literal.id),
    task("Outside instruction."),
  ];
  return { b, frame, empty, literal };
}
function localDialog(b, run, { lang = "en", view } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html lang="${lang}"><body></body></html>`,
    { url: "https://whiteboard.test", pretendToBeVisual: true },
  );
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
  try {
    setLanguage(lang);
    const opened = openTasksDialog({
      board: () => b,
      view,
      now: () => Date.parse("2026-09-30T12:00:00"),
      modal: (title, html, ready) => {
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
      canAdd: () => false,
      canPlan: () => false,
      selectedTasks: () => [],
      jira: { status: () => ({ available: false, message: "" }) },
      focusObject() {},
      placeTimeline() {},
      setStatusSync() {},
      download() {},
    });
    run({ ...opened, w: dom.window });
    opened.dialog.close();
  } finally {
    setLanguage(oldLanguage);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
}

test("frame metadata preserves authored whitespace, uncapped titles and language-only ranges through grouping without changing exports", async () => {
  const { b, frame } = framePlan();
  frame.text += " Continuons.".repeat(30);
  const source = JSON.stringify(b),
    rows = collectTasks(b),
    row = rows.find((r) => r.frameId === frame.id);
  assert.equal(row.frame, frame.text);
  assert.ok(row.frame.length > 200);
  assert.equal(row.frameLang, "fr-CA");
  validateTextRuns(row.frame, row.frameRuns);
  assert.deepEqual(row.frameRuns, [
    {
      start: frame.text.indexOf("Read"),
      end: frame.text.indexOf(" <img"),
      style: { lang: "en-CA" },
    },
  ]);
  const group = groupTasks(rows, "frame").find((g) => g.key === frame.id),
    lane = timelineModel(rows, {
      groupBy: "frame",
      today: "2026-09-30",
    }).lanes.find((l) => l.key === frame.id);
  for (const label of [group, lane]) {
    assert.equal(label.label, frame.text);
    assert.equal(label.labelGenerated, false);
    assert.equal(label.labelLang, "fr-CA");
    assert.deepEqual(label.labelRuns, row.frameRuns);
  }
  assert.equal(JSON.stringify(b), source);
  const original = await exportTasksCSV(rows).text();
  frame.lang = "fr";
  delete frame.textRuns;
  assert.equal(await exportTasksCSV(collectTasks(b)).text(), original);
});

test("frame choices retain selected values, disclosure, focus and language-only updates after reordering or removing frames", () => {
  const { b, frame, empty } = framePlan();
  localDialog(b, ({ dialog, refresh, w }) => {
    const choice = (id) =>
      [...dialog.querySelectorAll(".task-frame-choice")].find(
        (el) => el.value === id,
      );
    assert.equal(choice("*").checked, true);
    dialog.querySelector("#tasks-frame").open = true;
    choice(frame.id).click();
    assert.equal(choice(frame.id).checked, true);
    assert.equal(dialog.querySelectorAll("#tasks-list .task-go").length, 1);
    assert.equal(dialog.querySelector("#tasks-frame").open, true);
    assert.equal(document.activeElement, choice(frame.id));
    dialog.querySelector(".task-frame-filter .slide-choices").scrollTop = 57;
    frame.lang = "fr";
    frame.textRuns[0].style.lang = "en";
    b.items.reverse();
    refresh();
    assert.equal(document.activeElement, choice(frame.id));
    assert.equal(
      dialog.querySelector(".task-frame-filter .slide-choices").scrollTop,
      57,
    );
    assert.equal(choice(frame.id).checked, true);
    assert.equal(dialog.querySelector("#tasks-frame").open, true);
    assert.equal(
      dialog.querySelector('#tasks-frame-selected [lang="fr"]').textContent,
      frame.text,
    );
    assert.equal(
      choice(frame.id).closest("label").querySelector('[lang="en"]')
        .textContent,
      "Read first.",
    );
    assert.equal(
      dialog.querySelector("#tasks-frame-label").closest("[lang]"),
      document.documentElement,
    );
    assert.equal(document.querySelector("#frame-injection"), null);
    const group = dialog.querySelector("#tasks-group");
    group.value = "frame";
    group.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.ok(dialog.querySelector('.task-group h3 [lang="fr"]'));
    dialog.querySelector("#tasks-tab-timeline").click();
    const lanes = dialog.querySelector("#timeline-lanes");
    lanes.value = "frame";
    lanes.dispatchEvent(new w.Event("change", { bubbles: true }));
    lanes.focus();
    frame.lang = "fr-CA";
    refresh();
    assert.equal(document.activeElement.id, "timeline-lanes");
    assert.ok(dialog.querySelector('.timeline-lane-label [lang="fr-CA"]'));
    dialog.querySelector("#timeline-table").click();
    assert.ok(dialog.querySelector('#timeline-data td [lang="fr-CA"]'));
    dialog.querySelector("#tasks-tab-list").click();
    choice(frame.id).focus();
    b.items = b.items.filter((i) => i !== frame);
    refresh();
    assert.equal(choice("*").checked, true);
    assert.equal(choice(frame.id), undefined);
    assert.equal(dialog.querySelectorAll("#tasks-list .task-go").length, 4);
    assert.ok(dialog.contains(document.activeElement));
    choice(empty.id).click();
    assert.equal(dialog.querySelectorAll("#tasks-list .task-go").length, 1);
    choice("").click();
    assert.equal(dialog.querySelectorAll("#tasks-list .task-go").length, 2);
  });
});

test("translated frame fallbacks, literal labels, unknown authorship and no-frame choices retain independent context", () => {
  const { b, frame, empty, literal } = framePlan();
  delete frame.lang;
  delete frame.textRuns;
  localDialog(
    b,
    ({ dialog }) => {
      const choice = (id) =>
        [...dialog.querySelectorAll(".task-frame-choice")]
          .find((el) => el.value === id)
          .closest("label");
      assert.equal(choice(empty.id).textContent, "Cadre");
      assert.equal(choice(empty.id).querySelector("[lang]"), null);
      assert.equal(
        choice(literal.id).querySelector('[lang="en-CA"]').textContent,
        "Frame",
      );
      assert.equal(choice(frame.id).textContent, frame.text);
      assert.equal(choice(frame.id).querySelector("[lang]"), null);
      assert.equal(choice("").textContent, "Aucun cadre");
      assert.equal(choice("*").textContent, "Tous les cadres");
      translateUI(dialog);
      assert.equal(choice(frame.id).textContent, frame.text);
    },
    { lang: "fr" },
  );
});

test("frame choices and metadata derive only from the participant's visible task view", () => {
  const { b, frame } = framePlan(),
    visible = {
      ...b,
      items: b.items.filter((i) => i !== frame && i.parentId !== frame.id),
    };
  localDialog(
    b,
    ({ dialog }) => {
      assert.equal(
        [...dialog.querySelectorAll(".task-frame-choice")].some(
          (el) => el.value === frame.id,
        ),
        false,
      );
      assert.equal(dialog.textContent.includes(frame.text), false);
      assert.equal(dialog.querySelector('[lang="fr-CA"]'), null);
      assert.equal(dialog.querySelectorAll("#tasks-list .task-go").length, 3);
    },
    { view: () => visible },
  );
});

for (const view of [
  "column",
  "group",
  "caption",
  "lane",
  "filter",
  "timeline_table",
])
  test("WCAG saved frame declarations survive task " + view, async () => {
    const env = environment(),
      service = env.service,
      org = service.org;
    await adminCall(org, service, owner, {
      op: "org.setup",
      name: "Local notification audit",
    });
    const text = "Veuillez choisir les prochaines étapes. Read first.";
    const b = board("Assignment audit");
    b.items = [
      item("note", 0, 0, {
        text,
        lang: "fr-CA",
        textRuns: [
          {
            start: text.indexOf("Read"),
            end: text.length,
            style: { lang: "en-CA" },
          },
        ],
      }),
    ];
    const prerequisite = item("note", -200, 0, {
      text: "Por favor prepare el informe. Bonjour à tous.",
      lang: "es",
      textRuns: [
        {
          start: "Por favor prepare el informe. ".length,
          end: "Por favor prepare el informe. Bonjour à tous.".length,
          style: { lang: "fr-CA" },
        },
      ],
      task: { status: "todo", start: "2026-10-01", due: "2026-10-02" },
    });
    const frameText = "Veuillez discuter les prochaines étapes. Read first.";
    const frame = item("frame", -300, -100, {
      text: frameText,
      lang: "fr-CA",
      w: 800,
      h: 600,
      textRuns: [
        {
          start: frameText.indexOf("Read"),
          end: frameText.length,
          style: { lang: "en-CA" },
        },
      ],
    });
    b.items[0].parentId = frame.id;
    prerequisite.parentId = frame.id;
    b.items.push(frame);
    b.items.push(
      prerequisite,
      item("arrow", -100, 0, {
        startId: prerequisite.id,
        endId: b.items[0].id,
        dependency: "blocks",
      }),
    );
    const initial = new SharedDocument();
    initial.commit(b);
    await service.call(owner, {
      op: "create",
      room: b.id,
      update: encode(initial.update()),
    });
    initial.destroy();
    const invite = await service.call(owner, {
      op: "invite",
      room: b.id,
      role: "editor",
    });
    await service.call(editor, { op: "join", room: b.id, token: invite.token });
    const { doc: shared } = await service.load(b.id),
      before = shared.vector(),
      after = shared.snapshot();
    after.items[0].task = {
      assignee: { id: owner.uuid, name: owner.username },
      status: "todo",
      start: "2026-10-01",
      due: "2026-10-02",
    };
    shared.commit(after);
    const update = shared.update(before);
    shared.destroy();
    await service.call(editor, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
    const storedBoard = await service.load(b.id);
    const savedBoard = storedBoard.doc.snapshot(),
      savedMessage = savedBoard.items[0];
    storedBoard.doc.destroy();
    assert.equal(savedMessage.lang, "fr-CA");
    assert.deepEqual(savedMessage.textRuns, after.items[0].textRuns);
    const dom = new JSDOM(
      '<!doctype html><html lang="en"><body></body></html>',
      { url: "https://whiteboard.test" },
    );
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
    let dialog;
    try {
      setLanguage("en");
      const opened = openTasksDialog({
        board: () => savedBoard,
        now: () => Date.parse("2026-09-30T12:00:00"),
        modal: (title, html, ready) => {
          dialog = document.createElement("dialog");
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
        canAdd: () => true,
        canPlan: () => true,
        selectedTasks: () => [],
        jira: { status: () => ({ available: false, message: "" }) },
        focusObject() {},
        placeTimeline() {},
        setStatusSync() {},
        download() {},
      });
      const savedFrame = savedBoard.items.find((i) => i.id === frame.id);
      assert.equal(savedFrame.lang, "fr-CA");
      assert.deepEqual(savedFrame.textRuns, frame.textRuns);
      const group = dialog.querySelector("#tasks-group");
      group.value = "frame";
      group.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      const row = dialog
        .querySelector(`#tasks-list [data-task="${savedMessage.id}"]`)
        .closest("tr");
      const column = row.children[6],
        heading = dialog.querySelector(".task-group h3"),
        caption = dialog.querySelector(".task-table caption"),
        filter = [...dialog.querySelectorAll(".task-frame-choice")]
          .find((el) => el.value === frame.id)
          .closest("label");
      dialog.querySelector("#tasks-tab-timeline").click();
      const lanes = dialog.querySelector("#timeline-lanes");
      lanes.value = "frame";
      lanes.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      const lane = [...dialog.querySelectorAll(".timeline-lane-label")].find(
        (el) => el.textContent === frameText,
      );
      dialog.querySelector("#timeline-table").click();
      const timeline_table = dialog
        .querySelector(`#timeline-data [data-task="${savedMessage.id}"]`)
        .closest("tr").children[1];
      const target = {
        column,
        group: heading,
        caption,
        filter,
        lane,
        timeline_table,
      }[view];
      assert.ok(target);
      assert.ok(target.textContent.includes(frameText));
      assert.ok(
        target.querySelector('[lang="fr-CA"]'),
        "the actual " + view + " retains the saved French frame declaration",
      );
      assert.equal(
        target.querySelector('[lang="en-CA"]').textContent,
        "Read first.",
      );
    } finally {
      setLanguage(oldLanguage);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      dom.window.close();
    }
  });
