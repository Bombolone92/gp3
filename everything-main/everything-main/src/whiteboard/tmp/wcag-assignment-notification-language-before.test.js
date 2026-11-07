import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import { createOrganizationHome } from "../src/organization/home-ui.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner, editor } from "../tests/collaboration-helpers.js";

test("WCAG declared task language survives the actual assignment notification pipeline", async () => {
  const env = environment(), service = env.service, org = service.org;
  await adminCall(org, service, owner, { op: "org.setup", name: "Local notification audit" });
  const text = "Veuillez choisir les prochaines étapes. Read first.";
  const b = board("Assignment audit"); b.items = [item("note", 0, 0, { text, lang: "fr-CA", textRuns: [{ start: text.indexOf("Read"), end: text.length, style: { lang: "en-CA" } }] })];
  const initial = new SharedDocument(); initial.commit(b);
  await service.call(owner, { op: "create", room: b.id, update: encode(initial.update()) }); initial.destroy();
  const invite = await service.call(owner, { op: "invite", room: b.id, role: "editor" });
  await service.call(editor, { op: "join", room: b.id, token: invite.token });
  const { doc: shared } = await service.load(b.id), before = shared.vector(), after = shared.snapshot();
  after.items[0].task = { assignee: { id: owner.uuid, name: owner.username } };
  shared.commit(after); const update = shared.update(before); shared.destroy();
  await service.call(editor, { op: "commit", room: b.id, id: await hash(update), update: encode(update) });
  const storedBoard = await service.load(b.id);
  const savedMessage = storedBoard.doc.snapshot().items[0]; storedBoard.doc.destroy();
  assert.equal(savedMessage.lang, "fr-CA");
  assert.deepEqual(savedMessage.textRuns, after.items[0].textRuns);
  const result = await adminCall(org, service, owner, { op: "notifications.list" });
  const notice = result.items.find(n => n.type === "assignment"); assert.ok(notice); assert.equal(notice.title, text);
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: "https://whiteboard.test" });
  const keys = ["document", "localStorage", "HTMLElement", "Node", "Event", "NodeFilter"], previous = Object.fromEntries(keys.map(key => [key, globalThis[key]])), oldLanguage = language;
  for (const key of keys) globalThis[key] = dom.window[key];
  let dialog;
  try {
    setLanguage("en");
    const home = createOrganizationHome({
      org: { info: { role: "owner", user: {} }, onChange() {}, request: async (op, input) => adminCall(org, service, owner, { op, ...input }) },
      modal: (title, html, ready) => { dialog = document.createElement("dialog"); dialog.innerHTML = html; document.body.append(dialog); ready(dialog); translateUI(dialog); return dialog; },
      toast() {}, icon: () => "", openShared: async () => {},
    });
    await home.notifications();
    for (let n = 0; n < 100 && !dialog.querySelector(".notification"); n++) await new Promise(resolve => setTimeout(resolve, 1));
    const row = [...dialog.querySelectorAll(".notification")].find(el => el.dataset.note === notice.id);
    const rendered = row.querySelector("[data-user-content]"); assert.ok(rendered);
    console.log(JSON.stringify({ savedMessage, storedNotification: notice, pageLanguage: document.documentElement.lang, rendered: rendered.outerHTML }));
    assert.equal(rendered.textContent, "Bob: " + text);
    assert.ok(rendered.querySelector('[lang="fr-CA"]'), "the actual assignment notification loses the known French declaration");
    assert.equal(rendered.querySelector('[lang="en-CA"]').textContent, "Read first.");
  } finally {
    setLanguage(oldLanguage);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    dom.window.close();
  }
});
