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
import { collectTasks, exportTasksCSV } from "../src/planning/tasks.js";
import { validateTextRuns } from "../src/rich-text.js";

test("task views retain complete normalized titles and language-only ranges without changing exports", async () => {
  const prefix = "  Please continue. ".repeat(20),
    phrase = "Bonjour   à \n tous.",
    text = prefix + phrase + " \t End.  ",
    b = board("Titles");
  b.items = [
    item("note", 0, 0, {
      text,
      lang: "en-ca",
      task: { status: "todo" },
      textRuns: [
        {
          start: prefix.length,
          end: prefix.length + phrase.length,
          style: { lang: "fr-ca", bold: true },
        },
      ],
    }),
  ];
  const source = JSON.stringify(b),
    [row] = collectTasks(b);
  assert.equal(row.title, text.replace(/\s+/g, " ").trim());
  assert.ok(row.title.length > 200);
  assert.equal(row.titleLang, "en-CA");
  validateTextRuns(row.title, row.titleRuns);
  assert.equal(
    row.title.slice(row.titleRuns[0].start, row.titleRuns[0].end),
    "Bonjour à tous.",
  );
  assert.deepEqual(row.titleRuns[0].style, { lang: "fr-CA" });
  const original = await exportTasksCSV([row]).text();
  b.items[0].lang = "es";
  delete b.items[0].textRuns;
  assert.equal(await exportTasksCSV(collectTasks(b)).text(), original);
  b.items[0] = JSON.parse(source).items[0];
  assert.equal(JSON.stringify(b), source);
});

function localDialog(b, run, { lang = "en", tab = "list" } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html lang="${lang}"><body><button id="outside">Outside</button></body></html>`,
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
  const focused = [];
  try {
    setLanguage(lang);
    const opened = openTasksDialog(
      {
        board: () => b,
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
        focusObject: (id) => focused.push(id),
        placeTimeline() {},
        setStatusSync() {},
        download() {},
      },
      { tab },
    );
    run({ ...opened, w: dom.window, focused });
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
function localTasks() {
  const b = board("Task captions"),
    task = item("note", 0, 0, {
      text: "Veuillez choisir. Read first.",
      lang: "fr-CA",
      textRuns: [{ start: 18, end: 29, style: { lang: "en-CA" } }],
      task: { status: "todo", start: "2026-10-01", due: "2026-10-02" },
    }),
    prerequisite = item("text", -200, 0, {
      text: "Por favor prepare el informe.",
      lang: "es",
      task: { status: "todo", start: "2026-10-01", due: "2026-10-02" },
    });
  // Derive offsets from the text rather than relying on a translated phrase's length.
  task.textRuns = [
    {
      start: task.text.indexOf("Read"),
      end: task.text.length,
      style: { lang: "en-CA" },
    },
  ];
  b.items = [
    task,
    prerequisite,
    item("arrow", -100, 0, {
      startId: prerequisite.id,
      endId: task.id,
      dependency: "blocks",
    }),
  ];
  return { b, task, prerequisite };
}

test("language-only shared updates refresh list, chart, preview and dependency labels while retaining focus and filters", () => {
  const { b, task, prerequisite } = localTasks();
  localDialog(b, ({ dialog, refresh, w }) => {
    let control = dialog.querySelector("#tasks-status");
    control.value = "todo";
    control.dispatchEvent(new w.Event("change", { bubbles: true }));
    const row = () =>
      dialog.querySelector(`#tasks-list [data-task="${task.id}"]`);
    row().focus();
    task.lang = "fr";
    task.textRuns[0].style.lang = "en";
    prerequisite.lang = "es-MX";
    refresh();
    assert.equal(document.activeElement, row());
    assert.equal(dialog.querySelector("#tasks-status").value, "todo");
    assert.equal(row().querySelector('[lang="en"]').textContent, "Read first.");
    assert.ok(row().closest("tr").children[7].querySelector('[lang="es-MX"]'));
    const labelled = row()
      .getAttribute("aria-labelledby")
      .split(" ")
      .map((id) => document.getElementById(id));
    assert.equal(
      labelled.map((el) => el.textContent).join(" "),
      "Show on board: " + task.text,
    );
    assert.equal(labelled[0].closest("[lang]"), document.documentElement);
    dialog.querySelector("#tasks-tab-timeline").click();
    const bar = () =>
        dialog.querySelector(`.timeline-bar[data-task="${task.id}"]`),
      preview = dialog.querySelector("#tasks-title-preview");
    bar().focus();
    preview.focus();
    preview.scrollTop = 30;
    task.lang = "fr-CA";
    task.textRuns[0].style.lang = "en-CA";
    prerequisite.lang = "es";
    refresh();
    assert.equal(document.activeElement, preview);
    assert.equal(preview.scrollTop, 30);
    assert.ok(preview.querySelector('[lang="fr-CA"]'));
    assert.equal(
      preview.querySelector('[lang="en-CA"]').textContent,
      "Read first.",
    );
    const name = document.getElementById(bar().getAttribute("aria-labelledby"));
    assert.ok(name.querySelector('[lang="es"]'));
    assert.equal(
      name.lastChild.parentElement.closest("[lang]"),
      document.documentElement,
    );
    dialog.querySelector("#timeline-table").click();
    assert.equal(preview.hidden, true);
    const cell = dialog.querySelector(
      `#timeline-data [data-task="${task.id}"]`,
    );
    assert.ok(cell.querySelector('[lang="fr-CA"]'));
    assert.ok(cell.closest("tr").children[6].querySelector('[lang="es"]'));
  });
});

test("generated and unknown task titles keep their own context, including literal fallback words", () => {
  const b = board("Fallbacks");
  b.items = [
    item("note", 0, 0, {
      text: " \t ",
      lang: "en-CA",
      task: { status: "todo" },
    }),
    item("note", 200, 0, {
      text: "Untitled task",
      lang: "en-CA",
      task: { status: "todo" },
    }),
    item("note", 400, 0, {
      text: 'Unknown <img id="task-injection">',
      task: { status: "todo" },
    }),
  ];
  localDialog(
    b,
    ({ dialog }) => {
      const rows = b.items.map((i) =>
        dialog.querySelector(`[data-task="${i.id}"]`),
      );
      assert.equal(rows[0].textContent, "Tâche sans titre");
      assert.equal(rows[0].querySelector("[lang]"), null);
      assert.equal(
        rows[1].querySelector('[lang="en-CA"]').textContent,
        "Untitled task",
      );
      assert.equal(rows[2].textContent, b.items[2].text);
      assert.equal(rows[2].querySelector("[lang]"), null);
      assert.equal(document.querySelector("#task-injection"), null);
      translateUI(dialog);
      assert.equal(rows[2].textContent, b.items[2].text);
    },
    { lang: "fr" },
  );
});

test("task previews remain hoverable and focused, support scrolling and dismiss Escape without closing or navigating", () => {
  const { b, task } = localTasks();
  localDialog(
    b,
    ({ dialog, w, focused }) => {
      const bar = dialog.querySelector(`.timeline-bar[data-task="${task.id}"]`),
        preview = dialog.querySelector("#tasks-title-preview"),
        outside = document.querySelector("#outside");
      const mouse = (target, type, relatedTarget) =>
        target.dispatchEvent(
          new w.MouseEvent(type, { bubbles: true, relatedTarget }),
        );
      const key = (target, extra = {}) => {
        const event = new w.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
          ...extra,
        });
        target.dispatchEvent(event);
        return event;
      };
      mouse(bar, "mouseover", outside);
      assert.equal(preview.hidden, false);
      mouse(bar, "mouseout", preview);
      mouse(preview, "mouseover", bar);
      assert.equal(preview.hidden, false);
      mouse(preview, "mouseout", outside);
      assert.equal(preview.hidden, true);
      bar.focus();
      mouse(bar, "mouseover", outside);
      mouse(bar, "mouseout", outside);
      assert.equal(preview.hidden, false);
      preview.focus();
      preview.scrollTop = 100;
      preview.dispatchEvent(new w.Event("scroll"));
      assert.equal(preview.hidden, false);
      assert.equal(preview.getAttribute("role"), "region");
      assert.equal(preview.tabIndex, 0);
      assert.equal(key(preview, { isComposing: true }).defaultPrevented, false);
      assert.equal(preview.hidden, false);
      assert.equal(key(preview).defaultPrevented, true);
      assert.equal(preview.hidden, true);
      assert.equal(document.activeElement, bar);
      assert.equal(dialog.isConnected, true);
      assert.deepEqual(focused, []);
      mouse(bar, "mouseover", outside);
      assert.equal(preview.hidden, true);
      mouse(bar, "mouseout", outside);
      outside.focus();
      bar.focus();
      assert.equal(preview.hidden, false);
      preview.focus();
      w.dispatchEvent(new w.Event("resize"));
      assert.equal(preview.hidden, false);
      assert.equal(document.activeElement, preview);
      outside.focus();
      bar.focus();
      preview.focus();
      dialog.dispatchEvent(new w.Event("scroll"));
      assert.equal(preview.hidden, false);
      assert.equal(document.activeElement, preview);
      outside.focus();
      bar.focus();
      preview.focus();
      outside.focus();
      assert.equal(preview.hidden, true);
      outside.focus();
      bar.focus();
      dialog.close();
      mouse(bar, "mouseover", outside);
      assert.equal(preview.hidden, true);
    },
    { tab: "timeline" },
  );
});

test("timeline previews follow their owner in keyboard order and remain available through focused dialog scrolling", () => {
  for (const lang of ["en", "fr"]) {
    const { b, task } = localTasks();
    localDialog(
      b,
      ({ dialog, refresh, w, focused }) => {
        let bar = dialog.querySelector(`.timeline-bar[data-task="${task.id}"]`);
        const preview = dialog.querySelector("#tasks-title-preview");
        let top = 300;
        bar.getBoundingClientRect = () => ({ left: 30, top, bottom: top + 20 });
        bar.focus();
        assert.equal(preview.previousElementSibling, bar);
        assert.equal(preview.hidden, false);
        assert.equal(preview.style.top, "320px");
        top = 200;
        dialog.dispatchEvent(new w.Event("scroll"));
        assert.equal(preview.hidden, false);
        assert.equal(preview.style.top, "220px");
        assert.equal(document.activeElement, bar);
        preview.focus();
        preview.scrollTop = 80;
        dialog.dispatchEvent(new w.Event("scroll"));
        assert.equal(preview.hidden, false);
        assert.equal(preview.scrollTop, 80);
        assert.equal(document.activeElement, preview);
        task.text += " More.";
        refresh();
        bar = dialog.querySelector(`.timeline-bar[data-task="${task.id}"]`);
        assert.equal(preview.previousElementSibling, bar);
        assert.equal(document.activeElement, preview);
        assert.equal(preview.hidden, false);
        assert.equal(preview.scrollTop, 80);
        assert.ok(preview.textContent.includes("More."));
        assert.equal(
          preview.querySelector('[lang="en-CA"]').textContent,
          "Read first.",
        );
        assert.deepEqual(focused, []);
        const escape = new w.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        preview.dispatchEvent(escape);
        assert.equal(escape.defaultPrevented, true);
        assert.equal(preview.hidden, true);
        assert.equal(document.activeElement, bar);
        assert.equal(preview.parentElement, dialog);
        dialog.dispatchEvent(new w.Event("scroll"));
        assert.equal(preview.hidden, true);
        document.querySelector("#outside").focus();
        bar.focus();
        assert.equal(preview.hidden, false);
        dialog.querySelector("#tasks-csv").focus();
        assert.equal(preview.hidden, true);
      },
      { lang, tab: "timeline" },
    );
  }
});

for (const lang of ["en", "fr"]) {
  test(`timeline previews persist across viewport changes in ${lang} without losing focus or reviving dismissed content`, () => {
    const { b, task } = localTasks(),
      before = JSON.stringify(b);
    localDialog(
      b,
      ({ dialog, w, focused }) => {
        const bar = dialog.querySelector(
            `.timeline-bar[data-task="${task.id}"]`,
          ),
          preview = dialog.querySelector("#tasks-title-preview"),
          outside = document.querySelector("#outside");
        let top = 150;
        bar.getBoundingClientRect = () => ({
          left: w.innerWidth - 60,
          top,
          bottom: top + 20,
        });
        preview.getBoundingClientRect = () => ({
          width: Number.parseFloat(preview.style.maxWidth),
          height: Math.min(100, Number.parseFloat(preview.style.maxHeight)),
        });
        const resize = (width, height) => {
          w.innerWidth = width;
          w.innerHeight = height;
          w.dispatchEvent(new w.Event("resize"));
        };
        resize(320, 400);
        assert.equal(preview.hidden, true);
        bar.focus();
        const markup = preview.innerHTML;
        assert.equal(preview.hidden, false);
        resize(320, 500);
        assert.equal(preview.hidden, false);
        assert.equal(document.activeElement, bar);
        assert.equal(preview.innerHTML, markup);
        preview.focus();
        preview.scrollTop = 80;
        top = 220;
        resize(200, 300);
        assert.equal(preview.hidden, false);
        assert.equal(document.activeElement, preview);
        assert.equal(preview.scrollTop, 80);
        assert.equal(preview.innerHTML, markup);
        const box = preview.getBoundingClientRect();
        assert.ok(Number.parseFloat(preview.style.left) >= 8);
        assert.ok(Number.parseFloat(preview.style.left) + box.width <= 192);
        assert.ok(Number.parseFloat(preview.style.top) >= 8);
        assert.ok(Number.parseFloat(preview.style.top) + box.height <= 292);
        assert.equal(preview.style.maxWidth, "184px");
        assert.ok(preview.querySelector('[lang="fr-CA"]'));
        assert.equal(
          preview.querySelector('[lang="en-CA"]').textContent,
          "Read first.",
        );
        outside.focus();
        assert.equal(preview.hidden, true);
        bar.dispatchEvent(
          new w.MouseEvent("mouseover", {
            bubbles: true,
            relatedTarget: outside,
          }),
        );
        assert.equal(preview.hidden, false);
        resize(320, 500);
        assert.equal(preview.hidden, false);
        assert.equal(document.activeElement, outside);
        bar.dispatchEvent(
          new w.MouseEvent("mouseout", {
            bubbles: true,
            relatedTarget: outside,
          }),
        );
        assert.equal(preview.hidden, true);
        resize(320, 400);
        assert.equal(preview.hidden, true);
        bar.focus();
        preview.focus();
        const escape = new w.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        preview.dispatchEvent(escape);
        assert.equal(escape.defaultPrevented, true);
        assert.equal(document.activeElement, bar);
        resize(320, 500);
        assert.equal(preview.hidden, true);
        assert.equal(document.activeElement, bar);
        outside.focus();
        bar.focus();
        assert.equal(preview.hidden, false);
        dialog.close();
        resize(320, 400);
        assert.equal(preview.hidden, true);
        assert.equal(dialog.isConnected, false);
        assert.deepEqual(focused, []);
        assert.equal(JSON.stringify(b), before);
      },
      { lang, tab: "timeline" },
    );
  });
}

test("a removed or hidden preview owner restores focus inside the current task tab", () => {
  const { b, task } = localTasks();
  localDialog(
    b,
    ({ dialog, refresh }) => {
      const bar = dialog.querySelector(`.timeline-bar[data-task="${task.id}"]`),
        preview = dialog.querySelector("#tasks-title-preview");
      bar.focus();
      preview.focus();
      task.task = { ...task.task, start: null, due: null };
      refresh();
      assert.equal(preview.hidden, true);
      assert.equal(document.activeElement.id, "tasks-tab-timeline");
      dialog.querySelector(".timeline-bar").focus();
      assert.equal(preview.hidden, false);
      dialog.querySelector("#tasks-tab-list").click();
      assert.equal(preview.hidden, true);
      assert.equal(document.activeElement.id, "tasks-tab-list");
    },
    { tab: "timeline" },
  );
});

for (const view of [
  "list",
  "timeline_name",
  "timeline_table",
  "blocked_list",
  "blocked_name",
  "blocked_table",
  "timeline_tooltip",
])
  test("WCAG saved task declarations survive " + view, async () => {
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
      const id = savedMessage.id;
      const list = dialog.querySelector(`#tasks-list [data-task="${id}"]`);
      assert.equal(list.textContent, text);
      dialog.querySelector("#tasks-tab-timeline").click();
      const blockedList = list.closest("tr").children[7];
      const bar = dialog.querySelector(`[data-task="${id}"].timeline-bar`);
      assert.ok(bar);
      const name = dialog.querySelector(
        "#" + bar.getAttribute("aria-labelledby"),
      );
      bar.focus();
      const preview = dialog
        .querySelector("#tasks-title-preview")
        .cloneNode(true);
      dialog.querySelector("#timeline-table").click();
      const table = dialog.querySelector(`#timeline-data [data-task="${id}"]`);
      assert.equal(table.textContent, text);
      const blockedTable = table.closest("tr").children[6];

      if (view === "timeline_tooltip") {
        assert.equal(bar.hasAttribute("title"), false);
        assert.equal(preview.hidden, false);
        assert.equal(preview.querySelector('[lang="fr-CA"]').textContent, text);
        assert.equal(
          preview.querySelector('[lang="en-CA"]').textContent,
          "Read first.",
        );
      } else if (view.startsWith("blocked")) {
        const target =
          view === "blocked_list"
            ? blockedList
            : view === "blocked_name"
              ? name
              : blockedTable;
        assert.ok(
          target.querySelector('[lang="es"]'),
          "the actual dependency view loses the saved Spanish declaration",
        );
        assert.equal(
          target.querySelector('[lang="es"] [lang="fr-CA"]').textContent,
          "Bonjour à tous.",
        );
      } else {
        const target =
          view === "list" ? list : view === "timeline_name" ? name : table;
        assert.ok(
          target.querySelector('[lang="fr-CA"]'),
          "the actual " + view + " loses the saved French declaration",
        );
        assert.equal(
          target.querySelector('[lang="en-CA"]').textContent,
          "Read first.",
        );
      }
    } finally {
      setLanguage(oldLanguage);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      dom.window.close();
    }
  });
