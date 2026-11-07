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

for (const view of ["column", "group", "caption", "lane", "filter", "timeline_table"]) test("WCAG saved frame declarations survive task " + view, async () => {
  const env = environment(), service = env.service, org = service.org;
  await adminCall(org, service, owner, { op: "org.setup", name: "Local notification audit" });
  const text = "Veuillez choisir les prochaines étapes. Read first.";
  const b = board("Assignment audit"); b.items = [item("note", 0, 0, { text, lang: "fr-CA", textRuns: [{ start: text.indexOf("Read"), end: text.length, style: { lang: "en-CA" } }] })];
  const prerequisite = item("note", -200, 0, { text: "Por favor prepare el informe. Bonjour à tous.", lang: "es", textRuns: [{ start: "Por favor prepare el informe. ".length, end: "Por favor prepare el informe. Bonjour à tous.".length, style: { lang: "fr-CA" } }], task: { status: "todo", start: "2026-10-01", due: "2026-10-02" } });
  const frameText = "Veuillez discuter les prochaines étapes. Read first.";
  const frame = item("frame", -300, -100, { text: frameText, lang: "fr-CA", w: 800, h: 600, textRuns: [{ start: frameText.indexOf("Read"), end: frameText.length, style: { lang: "en-CA" } }] });
  b.items[0].parentId = frame.id;
  prerequisite.parentId = frame.id;
  b.items.push(frame);
  b.items.push(prerequisite, item("arrow", -100, 0, { startId: prerequisite.id, endId: b.items[0].id, dependency: "blocks" }));
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
    const savedFrame = savedBoard.items.find(i => i.id === frame.id);
    assert.equal(savedFrame.lang, "fr-CA");
    assert.deepEqual(savedFrame.textRuns, frame.textRuns);
    const group = dialog.querySelector("#tasks-group"); group.value = "frame";
    group.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const row = dialog.querySelector(`#tasks-list [data-task="${savedMessage.id}"]`).closest("tr");
    const column = row.children[6], heading = dialog.querySelector(".task-group h3"), caption = dialog.querySelector(".task-table caption"), filter = dialog.querySelector(`#tasks-frame option[value="${frame.id}"]`);
    const filterLanguage = filter.closest("[lang]")?.lang;
    dialog.querySelector("#tasks-tab-timeline").click();
    const lanes = dialog.querySelector("#timeline-lanes"); lanes.value = "frame";
    lanes.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const lane = [...dialog.querySelectorAll(".timeline-lane-label")].find(el => el.textContent === frameText);
    dialog.querySelector("#timeline-table").click();
    const timeline_table = dialog.querySelector(`#timeline-data [data-task="${savedMessage.id}"]`).closest("tr").children[1];
    const target = ({ column, group: heading, caption, filter, lane, timeline_table })[view];
    assert.ok(target); assert.ok(target.textContent.includes(frameText));
    console.log(JSON.stringify({ view, savedFrame, pageLanguage: document.documentElement.lang, target: target.outerHTML }));
    if (view === "filter") {
      assert.equal(filterLanguage, "fr-CA", "the actual frame-filter option loses the declared French context");
    } else {
      assert.ok(target.querySelector('[lang="fr-CA"]'), "the actual " + view + " loses the saved French frame declaration");
      assert.equal(target.querySelector('[lang="en-CA"]').textContent, "Read first.");
    }
  } finally {
    setLanguage(oldLanguage);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    dom.window.close();
  }
});
