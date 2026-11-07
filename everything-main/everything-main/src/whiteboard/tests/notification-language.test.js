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

async function notificationBoard(comments) {
  const env = environment(),
    service = env.service,
    org = service.org;
  await adminCall(org, service, owner, {
    op: "org.setup",
    name: "Local snapshot audit",
  });
  const b = board("Local notification snapshot");
  if (comments) b.comments = comments;
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
    role: "commenter",
  });
  await service.call(editor, { op: "join", room: b.id, token: invite.token });
  const commit = async (change, user = editor) => {
    const { doc } = await service.load(b.id),
      before = doc.vector(),
      after = doc.snapshot();
    change(after);
    doc.commit(after);
    const update = doc.update(before);
    doc.destroy();
    return service.call(user, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
  };
  const notices = async () =>
    (await adminCall(org, service, owner, { op: "notifications.list" })).items;
  return {
    env,
    service,
    org,
    b,
    commit,
    notices: async () =>
      (await notices()).filter(
        (n) => n.type === "mention" || n.type === "reply",
      ),
  };
}
const message = (id, text, user = editor, metadata = {}) => ({
  id,
  text,
  authorId: user.uuid,
  authorName: user.username,
  createdAt: 1,
  ...metadata,
});
const thread = (messages) => ({
  id: "t1",
  x: 0,
  y: 0,
  resolved: false,
  messages,
});

test("notification language snapshots clip Unicode ranges and remain independent of later comment changes", async () => {
  const { commit, notices } = await notificationBoard();
  const text = "@Alice " + "a".repeat(272) + "😀 End.";
  await commit((b) => {
    b.comments = [
      thread([
        message("m1", text, editor, {
          lang: "fr-ca",
          textRuns: [
            { start: 275, end: text.length, style: { lang: "en-ca" } },
          ],
        }),
      ]),
    ];
  });
  const before = (await notices())[0];
  assert.equal(before.type, "mention");
  assert.equal(before.excerpt.length, 279);
  assert.equal(before.excerpt, text.slice(0, 279));
  assert.equal(before.excerptLang, "fr-CA");
  assert.deepEqual(before.excerptRuns, [
    { start: 275, end: 279, style: { lang: "en-CA" } },
  ]);
  await commit((b) => {
    const m = b.comments[0].messages[0];
    m.text = "@Alice contenido cambiado.";
    m.lang = "es";
    delete m.textRuns;
    m.editedAt = 2;
  });
  assert.deepEqual(
    await notices(),
    [before],
    "editing the original neither retags nor resends a notification",
  );
  await commit((b) => {
    b.comments[0].messages[0].deleted = true;
    b.comments[0].messages[0].editedAt = 3;
  });
  assert.deepEqual(
    await notices(),
    [before],
    "deleted source content cannot erase the captured declaration",
  );
});

test("reply notifications retain passage-only declarations without inventing a whole-message language", async () => {
  const { commit, notices } = await notificationBoard([
    thread([message("m0", "A local opening comment.", owner)]),
  ]);
  const text = "Begin. Bonjour à tous. End.",
    start = text.indexOf("Bonjour"),
    end = text.indexOf(" End.");
  await commit((b) => {
    b.comments[0].messages.push(
      message("m1", text, editor, {
        textRuns: [{ start, end, style: { lang: "fr-CA" } }],
      }),
    );
  });
  const notice = (await notices())[0];
  assert.equal(notice.type, "reply");
  assert.equal(notice.excerpt, text);
  assert.equal(notice.excerptLang, undefined);
  assert.deepEqual(notice.excerptRuns, [
    { start, end, style: { lang: "fr-CA" } },
  ]);
  assert.equal(notice.text, "Bob: " + text);
});

test("unknown and out-of-excerpt language ranges are not assigned to untagged notification text", async () => {
  const { commit, notices } = await notificationBoard();
  const text = "@Alice " + "a".repeat(280) + "Bonjour à tous.";
  await commit((b) => {
    b.comments = [
      thread([
        message("m1", text, editor, {
          textRuns: [
            {
              start: text.indexOf("Bonjour"),
              end: text.length,
              style: { lang: "fr-CA" },
            },
          ],
        }),
      ]),
    ];
  });
  const notice = (await notices())[0];
  assert.equal(notice.excerpt.length, 280);
  assert.equal(notice.excerptLang, undefined);
  assert.equal(notice.excerptRuns, undefined);
  assert.equal(notice.text, "Bob: " + text.slice(0, 280));
  await commit((b) => {
    b.comments[0].messages.push(
      message("m2", "@Alice legacy unknown content."),
    );
  });
  const legacy = (await notices()).find(
    (n) => n.excerpt === "@Alice legacy unknown content.",
  );
  assert.ok(legacy);
  assert.equal(legacy.excerptLang, undefined);
  assert.equal(legacy.excerptRuns, undefined);
});

test("declared comment languages survive the actual worker and notification dialog", async () => {
  const env = environment(),
    service = env.service,
    org = service.org;
  await adminCall(org, service, owner, {
    op: "org.setup",
    name: "Local notification audit",
  });
  const b = board("Notification audit");
  b.items = [item("note", 0, 0, { text: "Local content" })];
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
    role: "commenter",
  });
  await service.call(editor, { op: "join", room: b.id, token: invite.token });
  const text = "@Alice veuillez choisir les prochaines étapes. Read first.";
  const { doc: shared } = await service.load(b.id),
    before = shared.vector(),
    after = shared.snapshot();
  after.comments = [
    {
      id: "t1",
      x: 0,
      y: 0,
      resolved: false,
      messages: [
        {
          id: "m1",
          authorId: editor.uuid,
          authorName: editor.username,
          text,
          lang: "fr-CA",
          textRuns: [
            {
              start: text.indexOf("Read"),
              end: text.length,
              style: { lang: "en-CA" },
            },
          ],
          createdAt: 1,
        },
      ],
    },
  ];
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
  const savedMessage = storedBoard.doc.snapshot().comments[0].messages[0];
  storedBoard.doc.destroy();
  assert.equal(savedMessage.lang, "fr-CA");
  assert.deepEqual(
    savedMessage.textRuns,
    after.comments[0].messages[0].textRuns,
  );
  const result = await adminCall(org, service, owner, {
    op: "notifications.list",
  });
  const notice = result.items.find((n) => n.type === "mention");
  assert.ok(notice);
  assert.equal(notice.excerpt, text);
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
      "the actual notification loses the known French declaration",
    );
    assert.equal(
      rendered.querySelector('[lang="en-CA"]').textContent,
      "Read first.",
    );
    assert.equal(
      rendered.hasAttribute("lang"),
      false,
      "actor and punctuation stay outside authored language",
    );
    // The row names the board the mention is on.
    assert.equal(
      row.querySelector(".notification-board").textContent,
      "Board: Notification audit",
    );
    const button = dialog.querySelector("#notify-read");
    button.click();
    for (let n = 0; n < 100 && button.disabled; n++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(dialog.querySelectorAll(".unread").length, 0);
    const read = (
      await adminCall(org, service, owner, { op: "notifications.list" })
    ).items.find((n) => n.id === notice.id);
    assert.equal(read.read, true);
    assert.equal(read.excerptLang, "fr-CA");
    assert.deepEqual(read.excerptRuns, [
      {
        start: text.indexOf("Read"),
        end: text.length,
        style: { lang: "en-CA" },
      },
    ]);
    [...dialog.querySelectorAll("button[data-note]")]
      .find((el) => el.dataset.note === notice.id)
      .click();
    for (let n = 0; n < 100 && !opened.length; n++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(opened[0][1], b.id);
    assert.equal(opened[0][2].thread, "t1");
  } finally {
    setLanguage(oldLanguage);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
