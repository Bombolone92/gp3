import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import { openTasksDialog } from "../src/planning/tasks-dialog.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner, editor } from "../tests/collaboration-helpers.js";

for (const view of ["list", "timeline_name", "timeline_table"]) test("WCAG saved task declarations survive " + view, async () => {
  const env = environment(), service = env.service, org = service.org;
  await adminCall(org, service, owner, { op: "org.setup", name: "Local notification audit" });
  const text = "Veuillez choisir les prochaines étapes. Read first.";
  const b = board("Assignment audit"); b.items = [item("note", 0, 0, { text, lang: "fr-CA", textRuns: [{ start: text.indexOf("Read"), end: text.length, style: { lang: "en-CA" } }] })];
  const initial = new SharedDocument(); initial.commit(b);
  await service.call(owner, { op: "create", room: b.id, update: encode(initial.update()) }); initial.destroy();
  const invite = await service.call(owner, { op: "invite", room: b.id, role: "editor" });
  await service.call(editor, { op: "join", room: b.id, token: invite.token });
  const { doc: shared } = await service.load(b.id), before = shared.vector(), after = shared.snapshot();
  after.items[0].task = { assignee: { id: owner.uuid, name: owner.username }, status: "todo", start: "2026-10-01", due: "2026-10-02" };
  shared.commit(after); const update = shared.update(before); shared.destroy();
  await service.call(editor, { op: "commit", room: b.id, id: await hash(update), update: encode(update) });
  const storedBoard = await service.load(b.id);
  const savedBoard = storedBoard.doc.snapshot(), savedMessage = savedBoard.items[0]; storedBoard.doc.destroy();
  assert.equal(savedMessage.lang, "fr-CA");
  assert.deepEqual(savedMessage.textRuns, after.items[0].textRuns);
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: "https://whiteboard.test" });
  const keys = ["document", "localStorage", "HTMLElement", "Node", "Event", "NodeFilter"], previous = Object.fromEntries(keys.map(key => [key, globalThis[key]])), oldLanguage = language;
  for (const key of keys) globalThis[key] = dom.window[key];
  let dialog;
  try {
    setLanguage("en");
    const opened = openTasksDialog({
      board: () => savedBoard, now: () => Date.parse("2026-09-30T12:00:00"),
      modal: (title, html, ready) => { dialog = document.createElement("dialog"); dialog.innerHTML = html; document.body.append(dialog); ready(dialog); translateUI(dialog); return dialog; },
      canAdd: () => true, canPlan: () => true, selectedTasks: () => [],
      jira: { status: () => ({ available: false, message: "" }) },
      focusObject() {}, placeTimeline() {}, setStatusSync() {}, download() {},
    });
    const id = savedMessage.id;
    const list = dialog.querySelector(`#tasks-list [data-task="${id}"]`);
    assert.equal(list.textContent, text);
    dialog.querySelector("#tasks-tab-timeline").click();
    const bar = dialog.querySelector(`[data-task="${id}"].timeline-bar`);
    assert.ok(bar);
    const name = dialog.querySelector("#" + bar.getAttribute("aria-labelledby"));
    dialog.querySelector("#timeline-table").click();
    const table = dialog.querySelector(`#timeline-data [data-task="${id}"]`);
    assert.equal(table.textContent, text);
    console.log(JSON.stringify({ savedMessage, pageLanguage: document.documentElement.lang, list: list.outerHTML, timelineBar: bar.outerHTML, timelineName: name.outerHTML, timelineTable: table.outerHTML }));
    const target = view === "list" ? list : view === "timeline_name" ? name : table;
    assert.ok(target.querySelector('[lang="fr-CA"]'), "the actual " + view + " loses the saved French declaration");
    assert.equal(target.querySelector('[lang="en-CA"]').textContent, "Read first.");
  } finally {
    setLanguage(oldLanguage);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    dom.window.close();
  }
});
