import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode } from "../src/collaboration/protocol.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner, editor } from "./collaboration-helpers.js";

const guest = {
  uuid: "44444444-4444-4444-8444-444444444444",
  username: "Dee",
};
function setup() {
  const env = environment();
  const boards = env.service,
    org = boards.org;
  org.puter.email = {
    async sendTransactional() {
      return { failed: [] };
    },
  };
  org.fetcher = boards.fetcher = async () =>
    new Response("{}", { status: 200 });
  const call = (user, input) => adminCall(org, boards, user, input);
  return { env, boards, org, call };
}
function createInput(title = "Planning") {
  const b = board(title),
    doc = new SharedDocument();
  b.items = [item("note", 0, 0, { text: title })];
  doc.commit(b);
  const input = { op: "create", room: b.id, update: encode(doc.update()) };
  doc.destroy();
  return { input, room: b.id };
}
async function invited(boards, room, user, role, extra = {}) {
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role,
    ...extra,
  });
  return boards.call(user, { op: "join", room, token });
}
// A dialog host for the board access module.
function dialogs() {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  let dialog;
  return {
    dom,
    modal: (title, html, ready) => {
      dialog = document.createElement("dialog");
      dialog.innerHTML = html;
      document.body.append(dialog);
      ready?.(dialog);
      return dialog;
    },
    dialog: () => dialog,
    close() {
      dom.window.close();
      for (const key of keys) delete globalThis[key];
    },
  };
}

test("a board tells its managers what its own organization lets it share", async () => {
  const { boards, call } = setup();
  const personal = createInput("Personal");
  await boards.call(owner, personal.input);
  const joined = await boards.call(owner, {
    op: "join",
    room: personal.room,
  });
  assert.deepEqual(joined.sharing, {
    organization: false,
    member: true,
    guests: true,
    publicLinks: true,
    guestRole: "facilitator",
  });
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const asGuest = await invited(boards, room, guest, "viewer");
  assert.deepEqual(asGuest.sharing, {
    organization: true,
    member: false,
    guests: true,
    publicLinks: false,
    guestRole: "facilitator",
  });
  await call(owner, {
    op: "org.policy.set",
    policy: { externalSharing: "anyone", publicLinks: true },
  });
  const { sharing } = await boards.call(owner, { op: "settings.get", room });
  assert.deepEqual(sharing, {
    organization: true,
    member: true,
    guests: true,
    publicLinks: true,
    guestRole: "facilitator",
  });
});

test("a guest facilitator manages participants but cannot open the board wider", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  await call(owner, {
    op: "org.policy.set",
    policy: { externalSharing: "anyone", publicLinks: true },
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await invited(boards, room, guest, "facilitator");
  await invited(boards, room, editor, "facilitator");
  for (const change of [
    { visibility: "organization" },
    { visibility: "link" },
    { linkRole: "editor" },
    { orgRole: "viewer" },
  ])
    await assert.rejects(
      boards.call(guest, { op: "settings", room, ...change }),
      {
        status: 403,
        message:
          "Only members of the organization can change who can open this board.",
      },
      JSON.stringify(change),
    );
  // Saving what is already set changes nothing, so it is not refused.
  await boards.call(guest, { op: "settings", room, visibility: "private" });
  // Inviting and managing people stay theirs.
  await boards.call(guest, { op: "invite", room, role: "viewer" });
  // A member facilitator decides, as the owner does.
  const { settings } = await boards.call(editor, {
    op: "settings",
    room,
    visibility: "organization",
  });
  assert.equal(settings.visibility, "organization");
});

test("board settings follow the board's own organization, not the viewer's", async () => {
  const host = dialogs();
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    let sharing = {
      organization: true,
      member: false,
      guests: true,
      publicLinks: false,
    };
    const session = {
      role: "facilitator",
      server: "https://whiteboard-abc.puter.work",
      settings: {
        visibility: "private",
        orgRole: "editor",
        linkRole: "viewer",
      },
      get sharing() {
        return sharing;
      },
      request: async (op) =>
        op === "settings.get"
          ? { settings: session.settings, sharing }
          : { members: [] },
    };
    const access = createBoardAccess({
      // The viewer belongs to no organization in this app.
      org: { info: null, policy: () => null, allows: () => false },
      session: () => session,
      board: () => ({ items: [] }),
      modal: host.modal,
      toast() {},
      icon: () => "",
    });
    await access.settings();
    let d = host.dialog();
    const fieldset = d.querySelector("#board-settings fieldset");
    // A guest sees the board's real choices, and why they cannot change them.
    assert.equal(fieldset.disabled, true);
    assert.match(
      d.querySelector("#bs-members-only").textContent,
      /Only members of the organization/,
    );
    const choice = (value) =>
      d.querySelector(`[name="bs-visibility"][value="${value}"]`);
    assert.ok(choice("organization"));
    assert.ok(d.querySelector("#bs-org-role"));
    assert.ok(choice("link").disabled);
    // With nothing they can change, there is nothing to save.
    assert.equal(d.querySelector("#board-settings .primary"), null);
    // A personal board has no organization to open to.
    sharing = {
      organization: false,
      member: true,
      guests: true,
      publicLinks: true,
    };
    await access.settings();
    d = host.dialog();
    assert.equal(d.querySelector("#board-settings fieldset").disabled, false);
    assert.equal(choice("organization"), null);
    assert.equal(d.querySelector("#bs-org-role"), null);
    assert.equal(choice("link").disabled, false);
    assert.ok(d.querySelector("#board-settings .primary"));
  } finally {
    host.close();
  }
});

test("a link can be kept to the organization's members", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  const { token: orgLink } = await call(owner, {
    op: "org.invite",
    role: "member",
  });
  await call(editor, { op: "org.join", token: orgLink });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
    membersOnly: true,
  });
  // Forwarded outside the organization, it lets no one in.
  await assert.rejects(boards.call(guest, { op: "join", room, token }), {
    status: 403,
    message: /only for members of the organization/,
  });
  assert.equal(await org.user(guest.uuid), null);
  const joined = await boards.call(editor, { op: "join", room, token });
  assert.equal(joined.member.role, "editor");
  assert.equal(joined.member.guest, undefined);
  // The share dialog can tell such a link from one for everyone.
  const status = (extra) =>
    boards.call(owner, {
      op: "invite-status",
      room,
      token,
      role: "editor",
      ...extra,
    });
  assert.equal((await status({ membersOnly: true })).valid, true);
  assert.equal((await status({})).valid, false);
  // Other links still admit outsiders as guests, as the policy allows.
  const open = await invited(boards, room, guest, "viewer");
  assert.equal(open.member.guest, true);
  const { entries } = await call(owner, { op: "org.audit" });
  assert.ok(
    entries.some(
      (e) =>
        e.action === "board.invite.created" && e.details.membersOnly === true,
    ),
  );
});

test("a member who opens a guest link joins as a member, even once guests are off", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  const { token: orgLink } = await call(owner, {
    op: "org.invite",
    role: "member",
  });
  await call(editor, { op: "org.join", token: orgLink });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
    guest: true,
  });
  await call(owner, {
    op: "org.policy.set",
    policy: { restrictToOrganization: true },
  });
  const joined = await boards.call(editor, { op: "join", room, token });
  assert.equal(joined.member.role, "editor");
  assert.equal(joined.member.guest, undefined);
});

test("on a personal board a link has no organization to keep to", async () => {
  const { boards } = setup();
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "viewer",
    membersOnly: true,
  });
  const joined = await boards.call(guest, { op: "join", room, token });
  assert.equal(joined.member.role, "viewer");
});

test("the share dialog offers a members-only link where the organization admits guests", async () => {
  const host = dialogs();
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    let sharing;
    const access = createBoardAccess({
      org: { info: null, policy: () => null, allows: () => false },
      session: () => ({ role: "owner", sharing }),
      board: () => ({ items: [] }),
      modal: host.modal,
      toast() {},
      icon: () => "",
    });
    const offered = (value) => {
      sharing = value;
      document.body.innerHTML = access.shareControls();
      return document.querySelector("#share-members");
    };
    const box = offered({
      organization: true,
      member: true,
      guests: true,
      publicLinks: false,
    });
    assert.equal(box.checked, false);
    assert.match(
      box.closest("label").textContent,
      /Only members of the organization can join with this link/,
    );
    // Every link is for members where guests are not admitted, and a
    // personal board has no members to keep it to.
    assert.equal(
      offered({ organization: true, member: true, guests: false }),
      null,
    );
    assert.equal(
      offered({ organization: false, member: true, guests: true }),
      null,
    );
  } finally {
    host.close();
  }
});

test("guests a policy shuts out show as inactive and stop counting as guests", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  await call(owner, {
    op: "org.policy.set",
    policy: { externalSharing: "anyone", publicLinks: true },
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await invited(boards, room, guest, "editor");
  const linked = {
    uuid: "77777777-7777-4777-8777-777777777777",
    username: "Lin",
  };
  await boards.call(owner, { op: "settings", room, visibility: "link" });
  await boards.call(linked, { op: "join", room });
  const state = async () => {
    const { members } = await boards.call(owner, { op: "members", room });
    const { sharing } = await call(owner, { op: "org.reports" });
    const listed = await call(owner, {
      op: "org.boards",
      scope: "all",
      guests: true,
    });
    return {
      inactive: members
        .filter((m) => m.inactive)
        .map((m) => m.username)
        .sort(),
      guests: sharing.guestMemberships,
      listed: listed.boards.length,
    };
  };
  assert.deepEqual(await state(), { inactive: [], guests: 2, listed: 1 });
  // Public links turned off: the guest who came by one is shut out.
  await call(owner, { op: "org.policy.set", policy: { publicLinks: false } });
  await assert.rejects(boards.call(linked, { op: "sync", room }), {
    status: 403,
  });
  assert.equal((await state()).inactive.join(), "Lin");
  // Each policy that keeps guests out shuts out both.
  for (const policy of [
    { guestAccess: false },
    { externalSharing: "none" },
    { restrictToOrganization: true },
  ]) {
    await call(owner, {
      op: "org.policy.set",
      policy: {
        externalSharing: "anyone",
        publicLinks: true,
        guestAccess: true,
        restrictToOrganization: false,
        ...policy,
      },
    });
    await assert.rejects(boards.call(guest, { op: "sync", room }), {
      status: 403,
    });
    assert.deepEqual(
      await state(),
      { inactive: ["Dee", "Lin"], guests: 0, listed: 0 },
      JSON.stringify(policy),
    );
  }
  // Letting guests in again brings them back.
  await call(owner, {
    op: "org.policy.set",
    policy: {
      externalSharing: "anyone",
      publicLinks: true,
      guestAccess: true,
      restrictToOrganization: false,
    },
  });
  assert.deepEqual(await state(), { inactive: [], guests: 2, listed: 1 });
});

test("managers see when a guest's access ends and can renew it", async () => {
  const { env, boards, call } = setup();
  const DAY = 86400_000;
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  await call(owner, { op: "org.policy.set", policy: { guestExpiryDays: 7 } });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await invited(boards, room, editor, "facilitator");
  const joinedAt = env.now;
  await invited(boards, room, guest, "editor");
  const row = async (who) =>
    (await boards.call(owner, { op: "members", room })).members.find(
      (m) => m.uuid === who.uuid,
    );
  assert.equal((await row(guest)).accessEnds, joinedAt + 7 * DAY);
  assert.equal((await row(editor)).accessEnds, undefined);
  // Five days in, renewing starts the seven days again.
  env.now += 5 * DAY;
  const { member } = await boards.call(editor, {
    op: "renew",
    room,
    uuid: guest.uuid,
  });
  assert.equal(member.accessEnds, env.now + 7 * DAY);
  env.now += 6 * DAY;
  await boards.call(guest, { op: "sync", room });
  // Once it has ended, they are shut out until someone renews it.
  env.now += 2 * DAY;
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    status: 403,
    message: /guest access to this board has expired/,
  });
  assert.equal((await row(guest)).inactive, true);
  await boards.call(owner, { op: "renew", room, uuid: guest.uuid });
  await boards.call(guest, { op: "sync", room });
  assert.equal((await row(guest)).inactive, undefined);
  const { entries } = await call(owner, { op: "org.audit" });
  assert.equal(
    entries.filter((e) => e.action === "board.guest.renewed").length,
    2,
  );
  // Only guests are renewed, by those who manage their role, while the
  // organization admits guests.
  await assert.rejects(
    boards.call(owner, { op: "renew", room, uuid: editor.uuid }),
    { status: 400 },
  );
  await boards.call(owner, {
    op: "role",
    room,
    uuid: guest.uuid,
    role: "facilitator",
  });
  await assert.rejects(
    boards.call(editor, { op: "renew", room, uuid: guest.uuid }),
    { status: 403 },
  );
  // Nor can a guest facilitator renew their own.
  await assert.rejects(
    boards.call(guest, { op: "renew", room, uuid: guest.uuid }),
    { status: 403 },
  );
  await call(owner, { op: "org.policy.set", policy: { guestAccess: false } });
  await assert.rejects(
    boards.call(owner, { op: "renew", room, uuid: guest.uuid }),
    { status: 403, message: /does not allow guest access/ },
  );
});

test("section links say which frames participants do not see yet", async () => {
  const host = dialogs();
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    const access = createBoardAccess({
      org: { info: null, policy: () => null, allows: () => false },
      session: () => ({ role: "owner" }),
      board: () => ({
        items: [
          item("frame", 0, 0, { id: "one", text: "Warm-up", order: 0 }),
          item("frame", 400, 0, { id: "two", text: "Answers", order: 1 }),
        ],
      }),
      hidden: (id) => id === "two",
      modal: host.modal,
      toast() {},
      icon: () => "",
    });
    document.body.innerHTML = access.shareControls();
    assert.deepEqual(
      [...document.querySelectorAll("#share-scope option")].map(
        (o) => o.textContent,
      ),
      [
        "The entire board",
        "Section: Warm-up",
        "Section: Answers (not shown to participants yet)",
      ],
    );
  } finally {
    host.close();
  }
});

test("a migration says when the guests it adds cannot open the board yet", async () => {
  const { boards, call } = setup();
  await call(owner, {
    op: "org.setup",
    name: "Fabrikam",
    domains: ["fabrikam.test"],
  });
  const migrate = async () => {
    const { input, room } = createInput();
    await boards.call(owner, input);
    return call(owner, {
      op: "migration.apply",
      room,
      members: [
        { email: "ann@fabrikam.test", role: "editor", guest: true },
        { email: "partner@example.org", role: "viewer" },
      ],
    });
  };
  // Ann is a member here, though Miro called her a guest.
  const ann = {
    uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    username: "Ann",
  };
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(ann, { op: "org.join", token });
  const meta = await boards.org.kv.get("org:user:" + ann.uuid);
  await boards.org.saveUser({ ...meta, email: "ann@fabrikam.test" });
  const allowed = await migrate();
  assert.ok(!allowed.warnings.some((w) => /admit guests/.test(w)));
  await call(owner, {
    op: "org.policy.set",
    policy: { restrictToOrganization: true },
  });
  const refused = await migrate();
  assert.ok(
    refused.warnings.includes(
      "1 guest from Miro was added, but your organization does not admit guests now, so they cannot open this board until its policy does.",
    ),
  );
  assert.equal(refused.applied.length, 2);
});

test("an invitation for a role none can give is refused, not made an editor's", async () => {
  const { boards } = setup();
  const { input, room } = createInput();
  await boards.call(owner, input);
  for (const role of ["owner", "admin", "removed", 5])
    await assert.rejects(boards.call(owner, { op: "invite", room, role }), {
      status: 400,
      message: "Choose a role an invitation can give.",
    });
  // Without a role, an invitation is an editor's, as before.
  const { token } = await boards.call(owner, { op: "invite", room });
  const joined = await boards.call(guest, { op: "join", room, token });
  assert.equal(joined.member.role, "editor");
});

test("an organization can limit the role guests have on its boards", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  const { token: orgLink } = await call(owner, {
    op: "org.invite",
    role: "member",
  });
  await call(editor, { op: "org.join", token: orgLink });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await invited(boards, room, guest, "editor");
  // Unlimited by default: the guest edits.
  await boards.call(owner, {
    op: "role",
    room,
    uuid: guest.uuid,
    role: "facilitator",
  });
  await call(owner, {
    op: "org.policy.set",
    policy: { guestRole: "commenter" },
  });
  assert.equal(
    (await call(owner, { op: "org.info" })).policy.guestRole,
    "commenter",
  );
  // The guest now acts as a commenter, whatever their stored role.
  const asGuest = await boards.call(guest, { op: "join", room });
  assert.equal(asGuest.member.role, "commenter");
  assert.equal(asGuest.sharing.guestRole, "commenter");
  await assert.rejects(
    boards.call(guest, { op: "invite", room, role: "viewer" }),
    { status: 403 },
  );
  const row = async (who) =>
    (await boards.call(owner, { op: "members", room })).members.find(
      (m) => m.uuid === who.uuid,
    );
  assert.equal((await row(guest)).role, "commenter");
  // They cannot be given more, but can be given less.
  await assert.rejects(
    boards.call(owner, { op: "role", room, uuid: guest.uuid, role: "editor" }),
    {
      status: 403,
      message:
        "Your organization lets guests view and comment on boards, not edit them.",
    },
  );
  await boards.call(owner, {
    op: "role",
    room,
    uuid: guest.uuid,
    role: "viewer",
  });
  assert.equal((await row(guest)).role, "viewer");
  // A guest joining by an edit link joins as a commenter; a member does not.
  const other = {
    uuid: "88888888-8888-4888-8888-888888888888",
    username: "Oz",
  };
  const late = await invited(boards, room, other, "editor");
  assert.equal(late.member.role, "commenter");
  const member = await invited(boards, room, editor, "editor");
  assert.equal(member.member.role, "editor");
  // Raising the limit gives back a stored role.
  await boards.call(owner, {
    op: "role",
    room,
    uuid: guest.uuid,
    role: "commenter",
  });
  await call(owner, {
    op: "org.policy.set",
    policy: { guestRole: "viewer" },
  });
  assert.equal(
    (await boards.call(guest, { op: "join", room })).member.role,
    "viewer",
  );
  await call(owner, {
    op: "org.policy.set",
    policy: { guestRole: "facilitator" },
  });
  assert.equal(
    (await boards.call(guest, { op: "join", room })).member.role,
    "commenter",
  );
  // So does someone who joined while it was low.
  assert.equal(
    (await boards.call(other, { op: "join", room })).member.role,
    "editor",
  );
  // Unknown values are ignored.
  await call(owner, { op: "org.policy.set", policy: { guestRole: "owner" } });
  assert.equal(
    (await call(owner, { op: "org.info" })).policy.guestRole,
    "facilitator",
  );
});

test("guest role choices follow the organization's limit", async () => {
  const { assignableRoles } =
    await import("../src/organization/board-access.js");
  assert.deepEqual(assignableRoles("owner", "commenter"), [
    "commenter",
    "viewer",
  ]);
  assert.deepEqual(assignableRoles("facilitator", "editor"), [
    "editor",
    "commenter",
    "viewer",
  ]);
  assert.deepEqual(assignableRoles("owner"), [
    "facilitator",
    "editor",
    "commenter",
    "viewer",
  ]);
});

test("administrators choose the highest board role for guests in Policies", async () => {
  const host = dialogs();
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const { normalizePolicy } = await import("../worker/org.js");
    let policy = normalizePolicy({ name: "Fabrikam" });
    const saved = [];
    const admin = createAdminConsole({
      org: {
        server: "https://whiteboard-abc.puter.work",
        isAdmin: true,
        request: async (op, data) => {
          if (op === "org.policy.set") {
            saved.push(data.policy);
            policy = normalizePolicy({ ...policy, ...data.policy });
          }
          return op === "org.users.list"
            ? { owner: { uuid: "u1", username: "alice" }, users: [] }
            : op === "teams.list"
              ? { teams: [] }
              : { policy, secrets: {} };
        },
        refresh: async () => {},
      },
      modal: host.modal,
      toast() {},
      icon: () => "",
      download() {},
    });
    const settle = () => new Promise((r) => setTimeout(r, 20));
    const d = admin.open("policies");
    await settle();
    const field = d.querySelector("#p-guest-role");
    assert.equal(field.value, "facilitator");
    assert.deepEqual(
      [...field.options].map((o) => o.value),
      ["facilitator", "editor", "commenter", "viewer"],
    );
    assert.equal(
      field
        .closest("label")
        .textContent.startsWith("Highest board role for guests"),
      true,
    );
    // Without guests it has nothing to limit.
    const guests = d.querySelector("#p-guests");
    guests.checked = false;
    guests.dispatchEvent(
      new host.dom.window.Event("change", { bubbles: true }),
    );
    assert.equal(field.disabled, true);
    guests.checked = true;
    guests.dispatchEvent(
      new host.dom.window.Event("change", { bubbles: true }),
    );
    field.value = "commenter";
    d.querySelector("#policy-form").requestSubmit();
    await settle();
    assert.deepEqual(saved.at(-1), { guestRole: "commenter" });
  } finally {
    host.close();
  }
});

test("facilitators manage a guest by the role the guest acts with", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  const { token: orgLink } = await call(owner, {
    op: "org.invite",
    role: "member",
  });
  await call(editor, { op: "org.join", token: orgLink });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await invited(boards, room, editor, "facilitator");
  await invited(boards, room, guest, "facilitator");
  // A guest facilitator is the owner's to manage.
  await assert.rejects(
    boards.call(editor, { op: "renew", room, uuid: guest.uuid }),
    { status: 403 },
  );
  // Limited to editing, the guest is shown, and managed, as an editor.
  await call(owner, { op: "org.policy.set", policy: { guestRole: "editor" } });
  await boards.call(editor, { op: "renew", room, uuid: guest.uuid });
  await boards.call(editor, {
    op: "role",
    room,
    uuid: guest.uuid,
    role: "viewer",
  });
  await boards.call(editor, {
    op: "role",
    room,
    uuid: guest.uuid,
    role: "removed",
  });
});
