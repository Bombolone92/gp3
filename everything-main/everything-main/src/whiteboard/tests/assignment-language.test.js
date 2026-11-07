import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import { createOrganizationHome } from "../src/organization/home-ui.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner, editor } from "./collaboration-helpers.js";
import { capturedTaskTitle } from "../src/planning/task-title.js";
import { validateTextRuns } from "../src/rich-text.js";
import "../src/planning/i18n.js";

test("task title capture maps declarations across separated whitespace normalization", () => {
  const phrase = "Bonjour   à \n tous.",
    prefix = " \n Begin.  \t ",
    suffix = "  \tEnd. \n ",
    text = prefix + phrase + suffix;
  const source = {
    text,
    lang: "en-ca",
    textRuns: [
      {
        start: prefix.length,
        end: prefix.length + phrase.length,
        style: { lang: "fr-ca", bold: true },
      },
    ],
  };
  validateTextRuns(text, source.textRuns);
  const captured = capturedTaskTitle(source);
  assert.equal(captured.title, "Begin. Bonjour à tous. End.");
  assert.equal(captured.titleGenerated, false);
  assert.equal(captured.titleLang, "en-CA");
  assert.deepEqual(captured.titleRuns, [
    { start: 7, end: 7 + "Bonjour à tous.".length, style: { lang: "fr-CA" } },
  ]);
  validateTextRuns(captured.title, captured.titleRuns);
  assert.equal(
    captured.title.slice(7, 7 + "Bonjour à tous.".length),
    "Bonjour à tous.",
  );
  assert.equal(source.text, text);
  assert.equal(source.textRuns[0].style.bold, true);
});

test("task title limits retain complete characters and clip only visible language ranges", () => {
  const text = "a".repeat(199) + "😀 Bonjour.";
  const captured = capturedTaskTitle({
    text,
    lang: "en",
    textRuns: [{ start: 195, end: text.length, style: { lang: "fr" } }],
  });
  assert.equal(captured.title, "a".repeat(199));
  assert.deepEqual(captured.titleRuns, [
    { start: 195, end: 199, style: { lang: "fr" } },
  ]);
  validateTextRuns(captured.title, captured.titleRuns);
  const outside = capturedTaskTitle({
    text,
    textRuns: [
      {
        start: text.indexOf("Bonjour"),
        end: text.length,
        style: { lang: "fr" },
      },
    ],
  });
  assert.equal(outside.titleRuns, undefined);
  assert.equal(outside.titleLang, undefined);
  const exact = capturedTaskTitle({
    text: "a".repeat(198) + "😀 end",
    textRuns: [{ start: 198, end: 200, style: { lang: "fr" } }],
  });
  assert.equal(exact.title, "a".repeat(198) + "😀");
  assert.deepEqual(exact.titleRuns, [
    { start: 198, end: 200, style: { lang: "fr" } },
  ]);
  validateTextRuns(exact.title, exact.titleRuns);
});

test("generated task title fallback has its own context and is distinct from literal authored text", () => {
  assert.deepEqual(
    capturedTaskTitle({
      text: " \t\n ",
      lang: "fr-CA",
      textRuns: [{ start: 0, end: 4, style: { lang: "fr" } }],
    }),
    { title: "Untitled task", titleGenerated: true },
  );
  assert.deepEqual(
    capturedTaskTitle({ text: "Untitled task", lang: "en-ca" }),
    { title: "Untitled task", titleGenerated: false, titleLang: "en-CA" },
  );
  assert.deepEqual(capturedTaskTitle({ text: "Unknown original context" }), {
    title: "Unknown original context",
    titleGenerated: false,
  });
  const phrase = "Bonjour à tous.",
    text = "Begin.  " + phrase + "\t End.";
  const captured = capturedTaskTitle({
    text,
    textRuns: [{ start: 8, end: 8 + phrase.length, style: { lang: "fr" } }],
  });
  assert.equal(captured.titleLang, undefined);
  assert.deepEqual(captured.titleRuns, [
    { start: 7, end: 7 + "Bonjour à tous.".length, style: { lang: "fr" } },
  ]);
});

async function taskBoard(items) {
  const env = environment(),
    service = env.service,
    org = service.org;
  await adminCall(org, service, owner, {
    op: "org.setup",
    name: "Local assignment capture audit",
  });
  const b = board("Local tasks");
  b.items = items;
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
  const commit = async (change) => {
    const { doc } = await service.load(b.id),
      before = doc.vector(),
      after = doc.snapshot();
    change(after);
    doc.commit(after);
    const update = doc.update(before);
    doc.destroy();
    return service.call(editor, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
  };
  const notices = async () =>
    (
      await adminCall(org, service, owner, { op: "notifications.list" })
    ).items.filter((n) => n.type === "assignment");
  return { env, service, org, b, commit, notices };
}

test("actual assignment snapshots preserve normalized tags, grouping and date after task edits and deletion", async () => {
  const phrase = "Bonjour   à tous.",
    prefix = "  Begin. \t",
    text = prefix + phrase + "  End.  ";
  const { org, commit, notices } = await taskBoard([
    item("note", 0, 0, {
      text,
      lang: "en-ca",
      textRuns: [
        {
          start: prefix.length,
          end: prefix.length + phrase.length,
          style: { lang: "fr-ca", bold: true },
        },
      ],
    }),
    item("note", 200, 0, { text: "Another instruction." }),
  ]);
  await commit((b) => {
    for (const i of b.items)
      i.task = {
        assignee: { id: owner.uuid, name: owner.username },
        due: "2026-10-01",
      };
  });
  const [notice] = await notices();
  assert.equal(notice.title, "Begin. Bonjour à tous. End.");
  assert.equal(notice.titleLang, "en-CA");
  assert.equal(notice.titleGenerated, false);
  assert.deepEqual(notice.titleRuns, [
    { start: 7, end: 7 + "Bonjour à tous.".length, style: { lang: "fr-CA" } },
  ]);
  assert.equal(notice.more, 1);
  assert.equal(notice.due, "2026-10-01");
  assert.equal(
    notice.text,
    "Bob: Begin. Bonjour à tous. End. (due 2026-10-01) and 1 more",
  );
  const saved = (await org.list("org:notif:" + owner.uuid + ":")).find(
    (row) => row.value.id === notice.id,
  ).value;
  assert.deepEqual(saved.titleRuns, notice.titleRuns);
  await commit((b) => {
    b.items[0].text = "Contenido cambiado.";
    b.items[0].lang = "es";
    delete b.items[0].textRuns;
  });
  assert.deepEqual(await notices(), [notice]);
  await commit((b) => {
    b.items = [];
  });
  assert.deepEqual(await notices(), [notice]);
});

test("assignment rendering keeps translated suffixes and generated text outside authored declarations", async () => {
  const dom = new JSDOM('<!doctype html><html lang="fr"><body></body></html>', {
    url: "https://whiteboard.test",
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
  const text = 'Please choose. Bonjour à tous. <img id="assignment-injection">';
  const start = text.indexOf("Bonjour"),
    end = text.indexOf(" <img");
  const items = [
    {
      id: "mixed",
      type: "assignment",
      at: 0,
      anonymous: true,
      title: text,
      titleGenerated: false,
      titleLang: "en-CA",
      titleRuns: [{ start, end, style: { lang: "fr-CA" } }],
      due: "2026-10-01",
      more: 2,
    },
    {
      id: "generated",
      type: "assignment",
      at: 0,
      actor: { username: "Bob" },
      title: "Untitled task",
      titleGenerated: true,
    },
    {
      id: "literal",
      type: "assignment",
      at: 0,
      actor: { username: "Bob" },
      title: "Untitled task",
      titleGenerated: false,
      titleLang: "en-CA",
    },
    {
      id: "old",
      type: "assignment",
      at: 0,
      actor: { username: "Bob" },
      title: "Unknown original language",
    },
  ];
  let dialog;
  try {
    setLanguage("fr");
    const home = createOrganizationHome({
      org: {
        info: { role: "owner", user: {} },
        onChange() {},
        request: async () => ({ items }),
      },
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        document.body.append(dialog);
        ready(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      openShared: async () => {},
    });
    await home.notifications();
    for (let n = 0; n < 100 && !dialog.querySelector(".notification"); n++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const row = (id) =>
      dialog.querySelector(`[data-note="${id}"] > [data-user-content]`);
    const mixed = row("mixed");
    assert.equal(mixed.hasAttribute("lang"), false);
    assert.match(mixed.textContent, /^Un participant : Please choose/);
    assert.equal(mixed.querySelector('[lang="en-CA"]').textContent, text);
    assert.equal(
      mixed.querySelector('[lang="fr-CA"]').textContent,
      "Bonjour à tous.",
    );
    assert.match(mixed.lastChild.textContent, /échéance.+et 2 autres/);
    assert.equal(
      mixed.lastChild.parentElement.closest("[lang]"),
      document.documentElement,
    );
    assert.equal(document.querySelector("#assignment-injection"), null);
    assert.equal(row("generated").textContent, "Bob : Tâche sans titre");
    assert.equal(row("generated").querySelector("[lang]"), null);
    assert.equal(row("literal").textContent, "Bob : Untitled task");
    assert.equal(
      row("literal").querySelector('[lang="en-CA"]').textContent,
      "Untitled task",
    );
    assert.equal(row("old").querySelector("[lang]"), null);
    translateUI(dialog);
    assert.equal(row("old").textContent, "Bob : Unknown original language");
  } finally {
    setLanguage(oldLanguage);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});

test("assignment declarations survive the real worker and notification dialog", async () => {
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
  after.items[0].task = { assignee: { id: owner.uuid, name: owner.username } };
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
  const savedMessage = storedBoard.doc.snapshot().items[0];
  storedBoard.doc.destroy();
  assert.equal(savedMessage.lang, "fr-CA");
  assert.deepEqual(savedMessage.textRuns, after.items[0].textRuns);
  const result = await adminCall(org, service, owner, {
    op: "notifications.list",
  });
  const notice = result.items.find((n) => n.type === "assignment");
  assert.ok(notice);
  assert.equal(notice.title, text);
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
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
  let dialog;
  const opened = [];
  try {
    setLanguage("en");
    const home = createOrganizationHome({
      org: {
        info: { role: "owner", user: {} },
        onChange() {},
        request: async (op, input) =>
          adminCall(org, service, owner, { op, ...input }),
      },
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        dialog.close = () => dialog.remove();
        document.body.append(dialog);
        ready(dialog);
        translateUI(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      openShared: async (...args) => {
        opened.push(args);
      },
    });
    await home.notifications();
    for (let n = 0; n < 100 && !dialog.querySelector(".notification"); n++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const row = [...dialog.querySelectorAll(".notification")].find(
      (el) => el.dataset.note === notice.id,
    );
    const rendered = row.querySelector("[data-user-content]");
    assert.ok(rendered);
    assert.equal(rendered.textContent, "Bob: " + text);
    assert.ok(
      rendered.querySelector('[lang="fr-CA"]'),
      "the actual assignment notification loses the known French declaration",
    );
    assert.equal(
      rendered.querySelector('[lang="en-CA"]').textContent,
      "Read first.",
    );
    assert.equal(rendered.hasAttribute("lang"), false);
    dialog.querySelector("#notify-read").click();
    for (
      let n = 0;
      n < 100 && dialog.querySelector("#notify-read").disabled;
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 1));
    const read = (
      await adminCall(org, service, owner, { op: "notifications.list" })
    ).items.find((n) => n.id === notice.id);
    assert.equal(read.read, true);
    assert.equal(read.titleLang, "fr-CA");
    assert.deepEqual(read.titleRuns, notice.titleRuns);
    [...dialog.querySelectorAll("button[data-note]")]
      .find((el) => el.dataset.note === notice.id)
      .click();
    for (let n = 0; n < 100 && !opened.length; n++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(opened[0][1], b.id);
    assert.equal(opened[0][2].objectId, b.items[0].id);
    assert.equal(opened[0][2].thread, undefined);
  } finally {
    setLanguage(oldLanguage);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
