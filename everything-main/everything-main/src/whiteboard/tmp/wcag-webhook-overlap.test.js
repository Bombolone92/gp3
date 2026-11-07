import test from "node:test";
import assert from "node:assert/strict";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import { adminCall, apiKey } from "../worker/admin.js";
import { restRoute, parseFilter, toCSV, openAPI } from "../worker/api.js";
import { auditCategory, mergePolicy, normalizePolicy } from "../worker/org.js";
import {
  hmac,
  sendHook,
  siem,
  siemRecord,
  unsentAudit,
} from "../worker/delivery.js";
import { reportSummary, sendScheduledReport } from "../worker/reports.js";
import { purge } from "../worker/retention.js";
import { createOrganization, ORG_KEY } from "../src/organization/client.js";
import { environment, owner, editor, viewer } from "../tests/collaboration-helpers.js";

const guest = {
  uuid: "44444444-4444-4444-8444-444444444444",
  username: "Dee",
};
function setup() {
  const env = environment();
  const boards = env.service,
    org = boards.org;
  const sent = [],
    fetched = [];
  org.puter.email = {
    async sendTransactional(message) {
      sent.push(message);
      return { failed: [] };
    },
  };
  org.fetcher = boards.fetcher = async (url, options = {}) => {
    fetched.push({ url: String(url), options });
    if (String(url).includes("/events/kv-handles"))
      return Response.json({ handle: "handle-x" });
    if (String(url).includes("login.microsoftonline.com"))
      return Response.json({ access_token: "entra-token", expires_in: 3600 });
    return new Response("{}", { status: 200 });
  };
  const call = (user, input) => adminCall(org, boards, user, input);
  return { env, boards, org, call, sent, fetched };
}
function createInput(
  title = "Planning",
  items = [item("note", 0, 0, { text: title })],
) {
  const b = board(title),
    doc = new SharedDocument();
  b.items = items;
  doc.commit(b);
  const input = { op: "create", room: b.id, update: encode(doc.update()) };
  doc.destroy();
  return { input, room: b.id };
}
async function commit(boards, user, room, change) {
  const { doc } = await boards.load(room);
  const before = doc.vector();
  const next = doc.snapshot();
  change(next);
  doc.commit(next);
  const update = doc.update(before);
  doc.destroy();
  return boards.call(user, {
    op: "commit",
    room,
    id: await hash(update),
    update: encode(update),
  });
}
async function join(env, user, token) {
  return env.service.call(user, {
    op: "join",
    room: token.room,
    token: token.token,
  });
}

test("policy patches keep known fields, validate addresses, and fill new defaults", () => {
  const policy = mergePolicy(normalizePolicy(), {
    name: "CDS",
    domains: ["cds-snc.ca", "@Example.CA"],
    unknown: true,
    ai: { enabled: false, bogus: 1 },
    externalSharing: "anyone",
  });
  assert.deepEqual(policy.domains, ["cds-snc.ca", "example.ca"]);
  assert.equal(policy.ai.enabled, false);
  assert.equal(policy.unknown, undefined);
  assert.equal(policy.ai.bogus, undefined);
  assert.throws(() => mergePolicy(policy, { domains: ["not a domain"] }), {
    status: 400,
  });
  assert.throws(
    () => mergePolicy(policy, { siem: { sentinel: { dcrId: "nope" } } }),
    { status: 400 },
  );
  for (const endpoint of [
    "https://evil.example/#.ingest.monitor.azure.com",
    "https://evil.example/?.ingest.monitor.azure.com",
    "https://wb.ingest.monitor.azure.com.evil.example/",
  ])
    assert.throws(
      () => mergePolicy(policy, { siem: { sentinel: { endpoint } } }),
      { status: 400 },
    );
  assert.equal(
    mergePolicy(policy, {
      siem: {
        sentinel: {
          endpoint: "https://wb.canadacentral-1.ingest.monitor.azure.com/",
        },
      },
    }).siem.sentinel.endpoint,
    "https://wb.canadacentral-1.ingest.monitor.azure.com",
  );
  mergePolicy(
    policy,
    JSON.parse('{"integrations":{"__proto__":{"enabled":true}}}'),
  );
  assert.equal({}.enabled, undefined, "policy patches cannot touch prototypes");
  assert.throws(() => mergePolicy(policy, { alerts: { emails: ["x"] } }), {
    status: 400,
  });
  const filled = normalizePolicy({ name: "Old", ai: { enabled: false } });
  assert.equal(filled.ai.enabled, false);
  assert.equal(filled.ai.summaries, true);
  assert.equal(filled.retention.auditDays, 365);
});

test("organization setup, invitations, and members creating boards", async () => {
  const { env, boards, call, org } = setup();
  const { input: early, room: legacy } = createInput("Before organization");
  await boards.call(owner, early);
  await assert.rejects(call(editor, { op: "org.setup", name: "CDS" }), {
    status: 403,
  });
  const info = await call(owner, {
    op: "org.setup",
    name: "CDS",
    domains: ["cds-snc.ca"],
  });
  assert.equal(info.configured, true);
  assert.equal(info.role, "owner");
  // Existing boards are backfilled into the directory.
  assert.equal(
    (await org.kv.get("org:board:" + legacy)).title,
    "Before organization",
  );
  await assert.rejects(call(editor, { op: "org.join" }), { status: 403 });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  const joined = await call(editor, { op: "org.join", token });
  assert.equal(joined.user.role, "member");
  const { input, room } = createInput("Member board");
  await boards.call(editor, input);
  const listed = await call(editor, { op: "org.boards", scope: "mine" });
  assert.deepEqual(
    listed.boards.map((b) => b.title),
    ["Member board"],
  );
  assert.equal(listed.boards[0].role, "owner");
  const all = await call(owner, { op: "org.boards", scope: "all" });
  assert.equal(all.boards.length, 2);
  await assert.rejects(call(editor, { op: "org.boards", scope: "all" }), {
    status: 403,
  });
  // Administrators can govern any board without a membership record.
  const adminView = await boards.call(owner, { op: "join", room });
  assert.equal(adminView.member.role, "owner");
  assert.equal(adminView.member.orgAdmin, true);
  // Unarchiving, as the admin console and board settings ask, is audited
  // as such rather than as restoring a deleted board.
  await boards.call(owner, { op: "archive", room });
  const unarchived = await boards.call(owner, { op: "unarchive", room });
  assert.equal(unarchived.settings.archived, false);
  // Policy can stop members from creating boards.
  await call(owner, {
    op: "org.policy.set",
    policy: { membersCanCreate: false },
  });
  await assert.rejects(boards.call(editor, createInput("Denied").input), {
    status: 403,
  });
  const actions = (await call(owner, { op: "org.audit" })).entries.map(
    (e) => e.action,
  );
  for (const action of [
    "org.created",
    "user.invited",
    "user.joined",
    "board.created",
    "board.archived",
    "board.unarchived",
    "policy.updated",
  ])
    assert.ok(actions.includes(action), action);
  assert.ok(!actions.includes("board.restored"));
  assert.ok(env.data.size > 0);
});

test("roles: commenters discuss without editing, facilitators manage access", async () => {
  const { boards } = setup();
  const { input, room } = createInput();
  await boards.call(owner, input);
  const facilitatorInvite = await boards.call(owner, {
    op: "invite",
    room,
    role: "facilitator",
  });
  await join({ service: boards }, editor, {
    room,
    token: facilitatorInvite.token,
  });
  const commenterInvite = await boards.call(editor, {
    op: "invite",
    room,
    role: "commenter",
  });
  await join({ service: boards }, viewer, {
    room,
    token: commenterInvite.token,
  });
  await assert.rejects(
    boards.call(editor, { op: "invite", room, role: "facilitator" }),
    {
      status: 403,
    },
  );
  await assert.rejects(
    commit(boards, viewer, room, (b) => (b.items[0].text = "Changed")),
    { status: 422 },
  );
  await commit(boards, viewer, room, (b) => {
    b.comments = [
      {
        id: "t1",
        x: 0,
        y: 0,
        resolved: false,
        messages: [
          {
            id: "m1",
            authorId: viewer.uuid,
            authorName: viewer.username,
            text: "Looks good @alice",
            createdAt: 1,
          },
        ],
      },
    ];
  });
  // The mention notifies the owner, whose username is Alice.
  const notes = await adminCall(boards.org, boards, owner, {
    op: "notifications.list",
  });
  assert.equal(notes.unread, 1);
  assert.equal(notes.items[0].type, "mention");
  await adminCall(boards.org, boards, owner, {
    op: "notifications.read",
    all: true,
  });
  assert.equal(
    (await adminCall(boards.org, boards, owner, { op: "notifications.list" }))
      .unread,
    0,
  );
  await boards.call(editor, {
    op: "role",
    room,
    uuid: viewer.uuid,
    role: "viewer",
  });
  await assert.rejects(
    commit(boards, viewer, room, (b) => (b.comments[0].resolved = true)),
    { status: 403 },
  );
});

test("a guest facilitator cannot file the board into the organization's spaces or teams", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { space } = await call(owner, { op: "spaces.create", name: "Plans" });
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "viewer",
    guest: true,
  });
  await boards.call(guest, { op: "join", room, token });
  await boards.call(owner, {
    op: "role",
    room,
    uuid: guest.uuid,
    role: "facilitator",
  });
  await assert.rejects(
    boards.call(guest, { op: "settings", room, space: space.id }),
    { status: 403 },
  );
  // Their other settings still save.
  const saved = await boards.call(guest, {
    op: "settings",
    room,
    linkRole: "commenter",
  });
  assert.equal(saved.settings.linkRole, "commenter");
  assert.equal(saved.settings.space ?? null, null);
});

test("a board is never transferred to someone the organization does not know", async () => {
  const { boards, call } = setup();
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  // They joined before the organization was set up, so it has no record.
  const other = {
    uuid: "66666666-6666-4666-8666-666666666666",
    username: "Outsider",
  };
  await boards.call(other, { op: "join", room, token });
  await call(owner, { op: "org.setup", name: "CDS" });
  await assert.rejects(
    boards.call(owner, { op: "transfer", room, uuid: other.uuid }),
    { status: 400 },
  );
  const { settings } = await boards.call(owner, { op: "settings.get", room });
  assert.ok(settings);
});

test("guest policy, visibility, and external sharing controls", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const invite = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await call(owner, {
    op: "org.policy.set",
    policy: { externalSharing: "none" },
  });
  await assert.rejects(
    join({ service: boards }, guest, { room, token: invite.token }),
    {
      status: 403,
    },
  );
  await call(owner, {
    op: "org.policy.set",
    policy: {
      externalSharing: "guests",
      guestExpiryDays: 1,
      alerts: { emails: ["sec@cds-snc.ca"] },
    },
  });
  const joined = await join({ service: boards }, guest, {
    room,
    token: invite.token,
  });
  assert.equal(joined.member.guest, true);
  assert.ok(joined.member.expires > Date.now());
  assert.equal((await org.user(guest.uuid)).role, "guest");
  assert.equal((await org.kv.get("org:board:" + room)).guestCount, 1);
  // Guest access expires.
  boards.now = () => Date.now() + 2 * 86400_000;
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    status: 403,
  });
  boards.now = Date.now;
  // Public links require the organization to allow them.
  await assert.rejects(
    boards.call(owner, { op: "settings", room, visibility: "link" }),
    {
      status: 403,
    },
  );
  await call(owner, {
    op: "org.policy.set",
    policy: { externalSharing: "anyone", publicLinks: true },
  });
  const settings = await boards.call(owner, {
    op: "settings",
    room,
    visibility: "link",
    linkRole: "commenter",
  });
  assert.equal(settings.settings.visibility, "link");
  // Turning public links off stops the link from admitting outsiders.
  await call(owner, { op: "org.policy.set", policy: { publicLinks: false } });
  const outsider = {
    uuid: "66666666-6666-4666-8666-666666666666",
    username: "Out",
  };
  await assert.rejects(boards.call(outsider, { op: "join", room }), {
    status: 403,
  });
  await call(owner, { op: "org.policy.set", policy: { publicLinks: true } });
  assert.equal(
    (await boards.call(outsider, { op: "join", room })).member.role,
    "commenter",
  );
  const alerts = (await call(owner, { op: "notifications.list" })).items.filter(
    (n) => n.type === "alert",
  );
  assert.ok(alerts.some((n) => n.action === "board.visibility.link"));
  // Organization-wide visibility admits members without an invitation.
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(viewer, { op: "org.join", token });
  await boards.call(owner, {
    op: "settings",
    room,
    visibility: "organization",
    orgRole: "commenter",
  });
  const member = await boards.call(viewer, { op: "join", room });
  assert.equal(member.member.role, "commenter");
  // Settings report the board's space and team, and saving other settings keeps them.
  const { space } = await call(owner, { op: "spaces.create", name: "Plans" });
  const { team } = await call(owner, { op: "teams.create", name: "Ops" });
  // Only a space and a team that exist can be chosen.
  await assert.rejects(
    boards.call(owner, { op: "settings", room, space: "sp-missing" }),
    { status: 400 },
  );
  await boards.call(owner, {
    op: "settings",
    room,
    space: space.id,
    team: team.id,
  });
  const kept = await boards.call(owner, {
    op: "settings",
    room,
    orgRole: "viewer",
  });
  assert.equal(kept.settings.space, space.id);
  assert.equal(kept.settings.team, team.id);
  const read = await boards.call(owner, { op: "settings.get", room });
  assert.equal(read.settings.orgRole, "viewer");
  assert.equal(read.settings.space, space.id);
  await assert.rejects(boards.call(viewer, { op: "settings.get", room }), {
    status: 403,
  });
  await boards.call(owner, { op: "settings", room, orgRole: "commenter" });
  const visible = await call(viewer, {
    op: "org.boards",
    scope: "organization",
  });
  assert.ok(visible.boards.some((b) => b.room === room));
});

test("deactivation, ownership transfer, archive, delete, legal hold, and retention", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  const { input, room } = createInput("Offboarding");
  await boards.call(editor, input);
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  await assert.rejects(boards.call(editor, { op: "sync", room }), {
    status: 403,
  });
  // Boards never go to a guest, whose access would expire.
  const invite = await call(owner, { op: "org.invite", role: "guest" });
  await call(guest, { op: "org.join", token: invite.token });
  await assert.rejects(
    call(owner, {
      op: "org.users.transfer",
      from: editor.uuid,
      to: guest.uuid,
    }),
    { status: 400 },
  );
  assert.equal((await org.kv.get("org:board:" + room)).owner, editor.uuid);
  const moved = await call(owner, {
    op: "org.users.transfer",
    from: editor.uuid,
    to: owner.uuid,
  });
  assert.equal(moved.transferred, 1);
  assert.equal((await org.kv.get("org:board:" + room)).owner, owner.uuid);
  await boards.call(owner, { op: "archive", room });
  assert.ok((await org.kv.get("org:board:" + room)).archived);
  await boards.call(owner, { op: "hold", room, enabled: true });
  await assert.rejects(boards.call(owner, { op: "delete", room }), {
    status: 409,
  });
  await boards.call(owner, { op: "hold", room, enabled: false });
  await boards.call(owner, { op: "delete", room });
  assert.ok((await org.list(`org:ub:`)).some((r) => r.key.endsWith(room)));
  org.now = () => Date.now() + 40 * 86400_000;
  let scanned = false;
  const list = org.kv.list.bind(org.kv);
  org.kv.list = (options) => {
    if (options.pattern === "org:ub:") scanned = true;
    return list(options);
  };
  await purge(org);
  org.kv.list = list;
  assert.equal(scanned, false, "purging a board reads only its own members");
  assert.equal(await org.kv.get("org:board:" + room), null);
  assert.equal(await org.kv.get(`wb:${room}:meta`), null);
  assert.ok(!(await org.list(`org:ub:`)).some((r) => r.key.endsWith(room)));
});

test("REST API keys, scopes, audit export, reports, and OpenAPI", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await boards.call(owner, createInput("Report me").input);
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "SIEM",
    scopes: ["audit:read"],
  });
  const request = (path, method = "GET", token = key) =>
    new Request("https://w.puter.work" + path, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  const rest = (path, method, token, body) =>
    restRoute(
      org,
      boards,
      request(path, method, token),
      method || "GET",
      path.replace(/^\/(v1|scim\/v2)\/?/, "").split("?")[0],
      body,
    );
  await assert.rejects(rest("/v1/audit", "GET", null), { status: 401 });
  // Reading organization data through the API is itself audited.
  await rest("/v1/audit", "GET", key);
  const reads = (await org.list("org:audit:")).filter(
    (r) => r.value.action === "api.read",
  );
  assert.ok(reads.length >= 1);
  assert.equal(reads.at(-1).value.category, "api");
  await assert.rejects(rest("/v1/users"), { status: 403 });
  const audit = await (await rest("/v1/audit?format=ndjson")).text();
  assert.ok(
    audit
      .split("\n")
      .some((line) => JSON.parse(line).action === "board.created"),
  );
  const { key: admin } = await call(owner, {
    op: "apikeys.create",
    name: "Automation",
    scopes: ["users:read", "boards:read", "reports:read", "boards:write"],
  });
  const report = await (await rest("/v1/reports", "GET", admin)).json();
  assert.equal(report.boards.total, 1);
  const boardsList = await (
    await rest("/v1/boards?query=report", "GET", admin)
  ).json();
  assert.equal(boardsList.boards.length, 1);
  const csv = await (await rest("/v1/reports/boards.csv", "GET", admin)).text();
  // Response.text() drops the byte order mark that helps Excel read UTF-8.
  assert.ok(csv.startsWith("room,title"));
  // Query strings and bodies never choose the operation a key runs.
  const listed = await (
    await rest("/v1/users?op=apikeys.create&name=x", "GET", admin)
  ).json();
  assert.ok(Array.isArray(listed.users));
  const { key: writer } = await call(owner, {
    op: "apikeys.create",
    name: "Teams",
    scopes: ["users:write"],
  });
  const { team } = await call(owner, { op: "teams.create", name: "Ops" });
  const patched = await (
    await rest("/v1/teams/" + team.id, "PATCH", writer, {
      op: "apikeys.create",
      name: "Escalated",
      scopes: ["scim"],
    })
  ).json();
  assert.equal(patched.team.id, team.id);
  assert.equal(patched.key, undefined);
  assert.equal((await call(owner, { op: "apikeys.list" })).keys.length, 3);
  // Webhook deliveries carry audit events, so subscribing needs audit:read.
  const hookBody = { url: "https://hooks.example.ca/x" };
  for (const scopes of [["webhooks:write"], ["webhooks:write", "audit:read"]]) {
    const { key: hooks } = await call(owner, {
      op: "apikeys.create",
      scopes,
    });
    const created = rest("/v1/webhooks", "POST", hooks, hookBody);
    if (scopes.length === 1) await assert.rejects(created, { status: 403 });
    else assert.equal((await created).status, 201);
  }
  const spec = openAPI("https://w.puter.work");
  assert.ok(spec.paths["/scim/v2/Users"]);
  // Every templated path declares its parameters, as OpenAPI 3.1 requires,
  // and operations describe their bodies and the statuses they answer.
  for (const [path, operations] of Object.entries(spec.paths)) {
    const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    assert.deepEqual(
      (operations.parameters || []).map((p) => [p.name, p.in, p.required]),
      names.map((name) => [name, "path", true]),
      path,
    );
    for (const [method, op] of Object.entries(operations)) {
      if (method === "parameters") continue;
      if (["post", "put", "patch"].includes(method))
        assert.ok(op.requestBody, `${method} ${path}`);
    }
  }
  assert.ok(spec.paths["/v1/teams"].post.responses[201]);
  assert.ok(spec.paths["/scim/v2/Users/{id}"].delete.responses[204]);
  assert.ok(spec.paths["/v1/teams/{id}"].delete.responses[200]);
  const keys = await call(owner, { op: "apikeys.list" });
  await call(owner, { op: "apikeys.revoke", id: keys.keys[0].id });
  assert.equal((await call(owner, { op: "apikeys.list" })).keys.length, 4);
});

const PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

test("SCIM provisioning links pending users by verified email and deactivates them", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Google",
    scopes: ["scim"],
  });
  const scim = (path, method = "GET", body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path.split("?")[0],
      body,
    );
  const created = await (
    await scim("Users", "POST", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "bob@cds-snc.ca",
      name: { givenName: "Bob", familyName: "B" },
      externalId: "g-123",
      active: true,
    })
  ).json();
  assert.equal(created.active, true);
  assert.equal(
    created["urn:ietf:params:scim:schemas:extension:whiteboard:2.0:User"]
      .linked,
    false,
  );
  const found = await (
    await scim("Users?filter=userName%20eq%20%22bob@cds-snc.ca%22")
  ).json();
  assert.equal(found.totalResults, 1);
  await assert.rejects(scim("Users", "POST", { userName: "bob@cds-snc.ca" }), {
    status: 409,
    scimType: "uniqueness",
  });
  await assert.rejects(scim("Users?filter=userName%20sw%20%22b%22"), {
    status: 400,
    scimType: "invalidFilter",
  });
  const group = await (
    await scim("Groups", "POST", {
      displayName: "Design",
      members: [{ value: created.id }],
    })
  ).json();
  // Bob signs in with Puter and verifies the address.
  await call(editor, { op: "email.start", email: "bob@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  await assert.rejects(
    call(editor, {
      op: "email.confirm",
      code: "000000" === code ? "111111" : "000000",
    }),
    {
      status: 400,
    },
  );
  // Parallel guesses share the five-attempt limit.
  const wrong = code === "000000" ? "111111" : "000000";
  const guesses = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      call(editor, { op: "email.confirm", code: wrong }),
    ),
  );
  assert.equal(
    guesses.filter((g) => g.reason?.status === 429).length,
    6,
    "only five attempts are evaluated",
  );
  await assert.rejects(call(editor, { op: "email.confirm", code }), {
    status: 429,
  });
  await call(editor, { op: "email.start", email: "bob@cds-snc.ca" });
  const fresh = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  const confirmed = await call(editor, { op: "email.confirm", code: fresh });
  assert.equal(confirmed.user.role, "member");
  assert.deepEqual(confirmed.user.teams, [group.id]);
  const linked = await (await scim("Users/" + created.id)).json();
  assert.equal(
    linked["urn:ietf:params:scim:schemas:extension:whiteboard:2.0:User"]
      .puterUsername,
    "Bob",
  );
  await scim("Users/" + created.id, "PATCH", {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    // Attributes Entra maps by default are ignored, not refused.
    Operations: [
      { op: "Replace", path: "title", value: "Former designer" },
      { op: "Add", path: 'phoneNumbers[type eq "work"].value', value: "1" },
      { op: "Replace", path: "active", value: "False" },
    ],
  });
  assert.equal((await org.user(editor.uuid)).status, "deactivated");
  await scim("Groups/" + group.id, "PATCH", {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{ op: "remove", path: `members[value eq "${created.id}"]` }],
  });
  assert.deepEqual((await org.kv.get("org:team:" + group.id)).members, []);
  const config = await (await scim("ServiceProviderConfig")).json();
  assert.equal(config.patch.supported, true);
  // Schemas describe each attribute fully (RFC 7643 section 7).
  const schemas = await (await scim("Schemas")).json();
  assert.equal(schemas.totalResults, 3);
  const userSchema = await (
    await scim("Schemas/urn:ietf:params:scim:schemas:core:2.0:User")
  ).json();
  const userName = userSchema.attributes.find((a) => a.name === "userName");
  assert.equal(userName.type, "string");
  assert.equal(userName.required, true);
  assert.equal(userName.uniqueness, "server");
  assert.ok(userSchema.attributes.every((a) => a.type && a.mutability));
  // A deleted account stays deactivated but is gone for the provider,
  // which can provision the same address again.
  await scim("Users/" + created.id, "DELETE");
  assert.equal((await org.user(editor.uuid)).status, "deactivated");
  await assert.rejects(scim("Users/" + created.id), { status: 404 });
  const listed = await (
    await scim("Users?filter=userName%20eq%20%22bob@cds-snc.ca%22")
  ).json();
  assert.equal(listed.totalResults, 0);
  const again = await scim("Users", "POST", {
    userName: "bob@cds-snc.ca",
    active: true,
  });
  assert.equal(again.status, 201);
  assert.equal(
    again.headers.get("location"),
    `https://w.puter.work/scim/v2/Users/${created.id}`,
  );
  assert.equal((await org.user(editor.uuid)).status, "active");
  // Deleted accounts leave their groups.
  const dan0 = await (
    await scim("Users", "POST", { userName: "dan0@cds-snc.ca" })
  ).json();
  const carol = await (
    await scim("Users", "POST", { userName: "carol@cds-snc.ca" })
  ).json();
  const team = await (
    await scim("Groups", "POST", {
      displayName: "Research",
      members: [{ value: carol.id }],
    })
  ).json();
  assert.equal(team.members.length, 1);
  const identity = await (
    await scim(`Groups/${team.id}?excludedAttributes=members`)
  ).json();
  assert.equal(identity.displayName, "Research");
  assert.equal(identity.members, undefined);
  // Entra checks membership with a members.value filter.
  const byMember = await (
    await scim(
      `Groups?filter=${encodeURIComponent(`id eq "${team.id}" and members.value eq "${carol.id}"`)}&excludedAttributes=members`,
    )
  ).json();
  assert.equal(byMember.totalResults, 1);
  const notMember = await (
    await scim(
      `Groups?filter=${encodeURIComponent(`members.value eq "${dan0.id}"`)}`,
    )
  ).json();
  assert.equal(notMember.totalResults, 0);
  // A patch without a path changes each attribute it carries.
  const patched = await (
    await scim("Groups/" + team.id, "PATCH", {
      schemas: [PATCH_OP],
      Operations: [
        {
          op: "replace",
          value: {
            displayName: "Research team",
            externalId: "ext-9",
            members: [{ value: carol.id }, { value: dan0.id }],
          },
        },
      ],
    })
  ).json();
  assert.equal(patched.displayName, "Research team");
  assert.equal(patched.externalId, "ext-9");
  assert.equal(patched.members.length, 2);
  await scim("Groups/" + team.id, "PATCH", {
    schemas: [PATCH_OP],
    Operations: [{ op: "remove", path: `members[value eq "${dan0.id}"]` }],
  });
  await scim("Users/" + carol.id, "DELETE");
  assert.deepEqual((await org.kv.get("org:team:" + team.id)).members, []);
  // Removing a role never grants it.
  const dan = await (
    await scim("Users", "POST", { userName: "dan@cds-snc.ca" })
  ).json();
  const roleOf = async (Operations) =>
    (
      await (
        await scim("Users/" + dan.id, "PATCH", {
          schemas: [PATCH_OP],
          Operations,
        })
      ).json()
    ).roles[0].value;
  assert.equal(
    await roleOf([
      { op: "remove", path: "roles", value: [{ value: "guest" }] },
    ]),
    "member",
  );
  assert.equal(
    await roleOf([{ op: "add", path: "roles", value: [{ value: "guest" }] }]),
    "guest",
  );
  assert.equal(
    await roleOf([
      { op: "remove", path: "roles", value: [{ value: "member" }] },
    ]),
    "guest",
  );
  assert.equal(
    await roleOf([{ op: "remove", path: 'roles[value eq "guest"]' }]),
    "member",
  );
  // Of the extension, only the role changes it.
  const EXT = "urn:ietf:params:scim:schemas:extension:whiteboard:2.0:User";
  assert.equal(
    await roleOf([{ op: "replace", path: `${EXT}:role`, value: "guest" }]),
    "guest",
  );
  assert.equal(
    await roleOf([{ op: "remove", path: `${EXT}:license` }]),
    "guest",
  );
  assert.equal(
    await roleOf([{ op: "replace", path: EXT, value: { role: "member" } }]),
    "member",
  );
  // Paths may name the core schema in full.
  const qualified = await (
    await scim("Users/" + dan.id, "PATCH", {
      schemas: [PATCH_OP],
      Operations: [
        {
          op: "replace",
          path: "urn:ietf:params:scim:schemas:core:2.0:User:displayName",
          value: "Dan D",
        },
      ],
    })
  ).json();
  assert.equal(qualified.displayName, "Dan D");
  // Provisioning an active account as inactive ends its sessions.
  const reprovisioned = await again.json();
  await scim("Users/" + reprovisioned.id, "DELETE");
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "active",
  });
  const revoked = [];
  const revoke = boards.revokeSessions;
  boards.revokeSessions = async (uuid) => {
    revoked.push(uuid);
    return revoke.call(boards, uuid);
  };
  await scim("Users", "POST", { userName: "bob@cds-snc.ca", active: false });
  boards.revokeSessions = revoke;
  assert.equal((await org.user(editor.uuid)).status, "deactivated");
  assert.deepEqual(revoked, [editor.uuid]);
  // Lists page with startIndex and count, and read unusable values as the
  // defaults.
  const groups = await (await scim("Groups")).json();
  assert.equal(groups.totalResults, 2);
  const second = await (await scim("Groups?startIndex=2&count=1")).json();
  assert.equal(second.startIndex, 2);
  assert.equal(second.itemsPerPage, 1);
  assert.equal(second.Resources[0].id, groups.Resources[1].id);
  const users = await (await scim("Users?count=abc")).json();
  assert.equal(users.itemsPerPage, users.totalResults);
  assert.equal(users.Resources.length, users.totalResults);
  assert.deepEqual(parseFilter('userName eq "a@b.ca" and externalId eq "x"'), [
    { attr: "username", value: "a@b.ca" },
    { attr: "externalid", value: "x" },
  ]);
  // "and" inside a quoted value belongs to the value.
  assert.deepEqual(parseFilter('displayName eq "Research and Development"'), [
    { attr: "displayname", value: "Research and Development" },
  ]);
  assert.throws(() => parseFilter('userName eq "a" and'), { status: 400 });
});

test("removing a SCIM group member the worker does not know keeps the others", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Entra",
    scopes: ["scim"],
  });
  const scim = async (path, method = "GET", body) => {
    const res = await restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path,
      body,
    );
    return res.status === 204 ? null : res.json();
  };
  const ann = await scim("Users", "POST", { userName: "ann@cds-snc.ca" });
  const ben = await scim("Users", "POST", { userName: "ben@cds-snc.ca" });
  const group = await scim("Groups", "POST", {
    displayName: "Design",
    members: [{ value: ann.id }, { value: ben.id }],
  });
  // The provider deletes Ben, then removes him from the group as well.
  await scim("Users/" + ben.id, "DELETE");
  for (const value of [[{ value: ben.id }], { value: "never-provisioned" }])
    await scim("Groups/" + group.id, "PATCH", {
      schemas: [PATCH_OP],
      Operations: [{ op: "remove", path: "members", value }],
    });
  assert.deepEqual((await org.kv.get("org:team:" + group.id)).members, [
    ann.id,
  ]);
  // Without a value, a removal still empties the group.
  await scim("Groups/" + group.id, "PATCH", {
    schemas: [PATCH_OP],
    Operations: [{ op: "remove", path: "members" }],
  });
  assert.deepEqual((await org.kv.get("org:team:" + group.id)).members, []);
});

test("domain capture joins verified users; SIEM and webhooks deliver signed events", async () => {
  const { boards, call, org, sent, fetched } = setup();
  await call(owner, {
    op: "org.setup",
    name: "CDS",
    domains: ["cds-snc.ca"],
  });
  await call(owner, {
    op: "org.policy.set",
    policy: {
      domainCapture: true,
      integrations: { webhooks: { enabled: true } },
      siem: {
        mode: "sentinel",
        sentinel: {
          tenantId: "11111111-2222-3333-4444-555555555555",
          clientId: "11111111-2222-3333-4444-666666666666",
          endpoint: "https://wb-abc.canadacentral-1.ingest.monitor.azure.com",
          dcrId: "dcr-0123456789abcdef0123456789abcdef",
          stream: "Custom-WhiteboardAudit",
        },
      },
    },
    secrets: { sentinel: "entra-secret" },
  });
  const { webhook, secret } = await call(owner, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/wb",
    events: ["user"],
  });
  await call(viewer, { op: "email.start", email: "cam@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  const result = await call(viewer, { op: "email.confirm", code });
  assert.equal(result.user.role, "member");
  await org.flush();
  const ingest = fetched.find((f) => f.url.includes("/dataCollectionRules/"));
  assert.ok(ingest, "audit events reach Sentinel");
  assert.equal(ingest.options.headers.Authorization, "Bearer entra-token");
  const records = JSON.parse(ingest.options.body);
  assert.ok(records.some((r) => r.Action === "email.verification.sent"));
  const hook = fetched.find((f) => f.url === webhook.url);
  assert.ok(hook, "user.joined reaches the webhook");
  assert.equal(
    hook.options.headers["X-Whiteboard-Signature"],
    "sha256=" + (await hmac(secret, hook.options.body)),
  );
  assert.equal(JSON.parse(hook.options.body).event, "user.joined");
  assert.equal(
    siemRecord({ id: "x", time: "t", actor: {}, target: {} }).EventId,
    "x",
  );
  assert.ok(toCSV([{ a: 'x,"y"' }], ["a"]).includes('"x,""y"""'));
});

test("content activity, search, duplicates, library governance, and AI policy", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput("Journey", [
    item("note", 0, 0, { text: "Service blueprint for passports" }),
  ]);
  await boards.call(owner, input);
  await boards.call(owner, createInput("Journey (copy)").input);
  await commit(boards, owner, room, (b) =>
    b.items.push(item("table", 0, 300, { cells: [["a"]] })),
  );
  const activity = await call(owner, { op: "org.board.activity", room });
  assert.ok(activity.entries.some((e) => e.action === "board.content.updated"));
  const found = await call(owner, {
    op: "org.boards",
    scope: "mine",
    query: "passports",
    content: true,
  });
  assert.deepEqual(
    found.boards.map((b) => b.room),
    [room],
  );
  const typed = await call(owner, {
    op: "org.boards",
    scope: "all",
    type: "table",
  });
  assert.deepEqual(
    typed.boards.map((b) => b.room),
    [room],
  );
  const duplicates = await call(owner, { op: "org.boards.duplicates" });
  assert.ok(duplicates.groups.some((g) => g.reason === "same title"));
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  await call(viewer, { op: "org.join", token });
  const template = JSON.stringify(board("Team template"));
  const submitted = await call(editor, {
    op: "library.submit",
    name: "Retro",
    board: template,
  });
  assert.equal(submitted.item.status, "pending");
  assert.equal((await call(viewer, { op: "library.list" })).items.length, 0);
  // The person who shared an item, and administrators, may remove it.
  assert.equal(
    (await call(editor, { op: "library.list" })).items[0].canRemove,
    true,
  );
  await call(owner, { op: "library.approve", id: submitted.item.id });
  assert.equal(
    (await call(viewer, { op: "library.list" })).items[0].canRemove,
    false,
  );
  assert.equal(
    (await call(owner, { op: "library.list" })).items[0].canRemove,
    true,
  );
  const item0 = await call(viewer, {
    op: "library.get",
    id: submitted.item.id,
  });
  assert.equal(JSON.parse(item0.board).title, "Team template");
  await call(owner, {
    op: "org.policy.set",
    policy: { ai: { enabled: false } },
  });
  await assert.rejects(
    call(editor, { op: "org.ai", task: "summarize", prompt: "Hi" }),
    { status: 403 },
  );
  await call(owner, {
    op: "org.policy.set",
    policy: { ai: { enabled: true } },
  });
  org.puter.ai = { chat: async () => ({ message: { content: "Summary" } }) };
  assert.equal(
    (await call(editor, { op: "org.ai", task: "summarize", prompt: "Hi" }))
      .text,
    "Summary",
  );
  const report = await call(owner, { op: "org.reports" });
  assert.equal(report.boards.total, 2);
});

test("migrations preserve owners and roles by email, activating on verification", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  const { input, room } = createInput("From Miro");
  await boards.call(owner, input);
  const result = await call(owner, {
    op: "migration.apply",
    room,
    members: [
      { email: "bob@cds-snc.ca", role: "owner", name: "Bob" },
      { email: "cam@cds-snc.ca", role: "commenter" },
      { email: "partner@example.org", role: "editor", guest: true },
      { role: "viewer" },
    ],
    source: {
      boardId: "uXjVabc",
      viewLink: "https://miro.com/app/board/uXjVabc=/",
    },
  });
  assert.equal(result.applied.length, 3);
  assert.equal(result.skipped.length, 1);
  const registered = await org.kv.get("org:board:" + room);
  assert.match(registered.owner, /^pending-/);
  assert.equal(registered.source, "miro");
  assert.equal(registered.guestCount, 1);
  await call(editor, { op: "email.start", email: "bob@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  await call(editor, { op: "email.confirm", code });
  const joined = await boards.call(editor, { op: "join", room });
  assert.equal(joined.member.role, "owner");
  assert.equal((await org.kv.get("org:board:" + room)).owner, editor.uuid);
  const mine = await call(editor, { op: "org.boards", scope: "mine" });
  assert.deepEqual(
    mine.boards.map((b) => b.room),
    [room],
  );
});

test("reports include time spent and anonymous ease-of-use feedback", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await org.recordTime(45_000, { flush: true });
  await assert.rejects(call(owner, { op: "feedback.submit", ease: 9 }), {
    status: 400,
  });
  await call(owner, { op: "feedback.submit", ease: 4, comment: "Fast" });
  await call(owner, { op: "feedback.submit", ease: 2 });
  const report = await call(owner, { op: "org.reports", days: 7 });
  assert.equal(report.feedback.responses, 2);
  assert.equal(report.feedback.averageEase, 3);
  assert.deepEqual(report.feedback.distribution, [0, 1, 0, 1, 0]);
  assert.equal(report.feedback.recent[0].comment, "Fast");
  assert.equal(report.feedback.recent[0].uuid, undefined);
  assert.equal(report.usage.minutesPerDay.length, 7);
  // The account owner counts as active once it has used the organization.
  await org.touch(owner);
  const refreshed = await call(owner, { op: "org.reports", days: 7 });
  assert.equal(refreshed.users.activeLast30Days, 1);
  assert.ok(boards);
});

test("verifying a provisioned address keeps a deactivation and a higher role", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await org.saveUser({
    uuid: editor.uuid,
    username: "Bob",
    role: "admin",
    status: "active",
    teams: [],
  });
  // A migration or SCIM leaves a pending member record for another address.
  await boards.org.saveUser({
    uuid: "55555555-5555-4555-8555-555555555555",
    email: "bob.alt@cds-snc.ca",
    role: "member",
    status: "pending",
    teams: [],
  });
  await org.kv.set(
    "org:email:" + (await hash("bob.alt@cds-snc.ca")),
    "55555555-5555-4555-8555-555555555555",
  );
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  await call(editor, { op: "email.start", email: "bob.alt@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  await call(editor, { op: "email.confirm", code });
  org.forgetUser(editor.uuid);
  const user = await org.user(editor.uuid);
  assert.equal(user.status, "deactivated");
  assert.equal(user.role, "admin");
  assert.equal(await org.role(editor), null);
});

test("a guest who verifies a provisioned member address gets a full license", async () => {
  const { call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await org.saveUser({
    uuid: editor.uuid,
    username: "Bob",
    role: "guest",
    license: "guest",
    status: "active",
    teams: [],
  });
  await org.saveUser({
    uuid: "55555555-5555-4555-8555-555555555555",
    email: "bob@cds-snc.ca",
    role: "member",
    status: "pending",
    teams: [],
  });
  await org.kv.set(
    "org:email:" + (await hash("bob@cds-snc.ca")),
    "55555555-5555-4555-8555-555555555555",
  );
  await call(editor, { op: "email.start", email: "bob@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  await call(editor, { op: "email.confirm", code });
  org.forgetUser(editor.uuid);
  const user = await org.user(editor.uuid);
  assert.equal(user.role, "member");
  assert.equal(user.license, "full");
  const { users } = await call(owner, { op: "org.users.list" });
  assert.equal(users.find((u) => u.uuid === editor.uuid).license, "full");
});

test("only the account owner changes an administrator's status", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const user of [editor, viewer])
    await org.saveUser({
      uuid: user.uuid,
      username: user.username,
      role: "admin",
      status: "active",
      teams: [],
    });
  await assert.rejects(
    call(editor, {
      op: "org.users.update",
      uuid: viewer.uuid,
      status: "deactivated",
    }),
    { status: 403 },
  );
  const same = await call(editor, {
    op: "org.users.update",
    uuid: viewer.uuid,
    status: "active",
  });
  assert.equal(same.user.status, "active");
  const done = await call(owner, {
    op: "org.users.update",
    uuid: viewer.uuid,
    status: "deactivated",
  });
  assert.equal(done.user.status, "deactivated");
});

test("organization directory data is limited to members", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput("Budget secretword");
  await boards.call(owner, input);
  await boards.call(owner, {
    op: "settings",
    room,
    visibility: "organization",
  });
  const { token } = await call(owner, { op: "org.invite", role: "guest" });
  await call(guest, { op: "org.join", token });
  for (const user of [guest, viewer]) {
    for (const op of ["teams.list", "spaces.list", "library.list"])
      await assert.rejects(call(user, { op }), { status: 403 });
    const found = await call(user, {
      op: "org.boards",
      scope: "organization",
      query: "secretword",
      content: true,
    });
    assert.equal(found.boards.length, 0);
  }
  await assert.rejects(call(viewer, { op: "feedback.submit", ease: 3 }), {
    status: 403,
  });
  assert.deepEqual(await call(guest, { op: "feedback.submit", ease: 3 }), {
    ok: true,
  });
  assert.ok(Array.isArray((await call(owner, { op: "teams.list" })).teams));
});

test("verifying an email does not make a stranger an organization guest", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  await assert.rejects(
    call(viewer, { op: "email.start", email: "eve@gmail.com" }),
    { status: 403 },
  );
  assert.equal(await org.user(viewer.uuid), null);
  assert.equal(await org.role(viewer), null);
  await assert.rejects(call(viewer, { op: "feedback.submit", ease: 1 }), {
    status: 403,
  });
});

test("deactivated people get no notifications or organization data", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  assert.equal(
    await org.notify(editor.uuid, { type: "mention", text: "secret" }),
    undefined,
  );
  assert.equal((await org.list(`org:notif:${editor.uuid}:`)).length, 0);
  for (const op of ["notifications.list", "org.boards", "library.list"])
    await assert.rejects(call(editor, { op }), { status: 403 });
  assert.equal((await call(editor, { op: "org.info" })).role, null);
});

test("recording activity never rewrites a changed user record", async () => {
  const { call, org, env } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "admin" });
  await call(editor, { op: "org.join", token });
  // Another instance demotes and deactivates the cached administrator.
  await org.kv.set("org:user:" + editor.uuid, {
    ...(await org.kv.get("org:user:" + editor.uuid)),
    role: "member",
    status: "deactivated",
  });
  await org.touch(editor);
  const stored = await org.kv.get("org:user:" + editor.uuid);
  assert.equal(stored.role, "member");
  assert.equal(stored.status, "deactivated");
  const { users } = await call(owner, { op: "org.users.list" });
  assert.equal(users.find((u) => u.uuid === editor.uuid).lastActive, env.now);
});

test("a policy change with an invalid secret saves nothing", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const secrets of [{ bogus: "x" }, { slack: "https://evil.example/" }])
    await assert.rejects(
      call(owner, {
        op: "org.policy.set",
        policy: { publicLinks: true },
        secrets,
      }),
      { status: 400 },
    );
  assert.equal((await org.policy()).publicLinks, false);
  assert.equal(await org.secret("slack"), null);
});

test("Jira status reads only the organization's project", async () => {
  const { boards, call, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  assert.throws(
    () =>
      mergePolicy(normalizePolicy(), {
        integrations: { jira: { project: 'WB" OR project is not EMPTY' } },
      }),
    { status: 400 },
  );
  await call(owner, {
    op: "org.policy.set",
    policy: {
      integrations: {
        jira: {
          enabled: true,
          site: "cds.atlassian.net",
          email: "svc@cds-snc.ca",
          project: "wb",
        },
      },
    },
    secrets: { jira: "token" },
  });
  const { input, room } = createInput("Plan");
  await boards.call(owner, input);
  await call(owner, { op: "org.jira.status", room, keys: ["HR-7", "WB-1"] });
  const url = new URL(fetched.at(-1).url);
  assert.equal(
    url.searchParams.get("jql"),
    'project = "WB" AND key in (HR-7,WB-1)',
  );
  // Jira answers in pages of 50 unless asked for more; every page is read.
  const org = boards.org;
  const keys = Array.from({ length: 100 }, (_, n) => `WB-${n + 1}`);
  const pages = [];
  org.fetcher = async (target) => {
    const u = new URL(target);
    pages.push(u.searchParams.get("maxResults"));
    const from = Number(u.searchParams.get("nextPageToken") || 0);
    return Response.json({
      issues: keys.slice(from, from + 50).map((key) => ({
        key,
        fields: { status: { name: "Done" } },
      })),
      ...(from + 50 < keys.length ? { nextPageToken: String(from + 50) } : {}),
    });
  };
  const { issues } = await call(owner, { op: "org.jira.status", room, keys });
  assert.equal(issues.length, 100);
  assert.deepEqual(pages, ["100", "100"]);
});

test("a deactivated account cannot join a board by invitation", async () => {
  const { boards, call, org, env } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const invite = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await assert.rejects(
    join({ service: boards }, editor, { room, token: invite.token }),
    { status: 403, message: "Your organization account is deactivated." },
  );
  assert.equal(await org.kv.get(`wb:${room}:member:${editor.uuid}`), null);
  assert.equal((await org.kv.get(`org:board:${room}`)).memberCount, 1);
  assert.ok(
    ![...env.data.values()].some(
      (v) =>
        v?.action === "board.guest.joined" ||
        (v?.action === "board.joined" && v.actor?.uuid === editor.uuid),
    ),
  );
});

test("a refused settings change leaves the board's visibility as it was", async () => {
  const { boards, call, org, env } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await assert.rejects(
    boards.call(owner, {
      op: "settings",
      room,
      visibility: "organization",
      team: "bad team!",
    }),
    { status: 400 },
  );
  assert.equal(
    (await org.kv.get(`wb:${room}:meta`)).visibility ?? "private",
    "private",
  );
  assert.equal((await org.kv.get(`org:board:${room}`)).visibility, "private");
  await boards.call(owner, {
    op: "settings",
    room,
    visibility: "organization",
  });
  assert.equal(
    (await org.kv.get(`wb:${room}:meta`)).visibility,
    "organization",
  );
  assert.equal(
    (await org.kv.get(`org:board:${room}`)).visibility,
    "organization",
  );
  assert.ok(
    [...env.data.values()].some(
      (v) => v?.action === "board.visibility.changed",
    ),
  );
});

test("board guests cannot use the organization's Jira connection", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: {
      externalSharing: "guests",
      integrations: {
        jira: {
          enabled: true,
          site: "cds.atlassian.net",
          email: "svc@cds-snc.ca",
          project: "WB",
        },
      },
    },
    secrets: { jira: "token" },
  });
  const { input, room } = createInput("Plan");
  await boards.call(owner, input);
  const invite = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await join({ service: boards }, guest, { room, token: invite.token });
  const fetched = [];
  org.fetcher = async (url) => {
    fetched.push(url);
    return Response.json({ issues: [], key: "WB-1" });
  };
  for (const request of [
    { op: "org.jira.status", room, keys: ["WB-1"] },
    { op: "org.jira.create", room, issues: [{ item: "i1", summary: "T" }] },
  ])
    await assert.rejects(call(guest, request), {
      status: 403,
      message: "Jira sync is available to organization members.",
    });
  assert.equal(fetched.length, 0);
  // A reply without an issue key is not a created issue.
  org.fetcher = async () => Response.json({});
  const { created } = await call(owner, {
    op: "org.jira.create",
    room,
    issues: [{ item: "i1", summary: "T" }],
  });
  assert.deepEqual(created, [
    { item: "i1", error: "Jira did not accept the request." },
  ]);
});

test("sending the same task to Jira from two places at once creates one issue", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: {
      integrations: {
        jira: {
          enabled: true,
          site: "cds.atlassian.net",
          email: "svc@cds-snc.ca",
          project: "WB",
        },
      },
    },
    secrets: { jira: "token" },
  });
  const { input, room } = createInput("Plan");
  await boards.call(owner, input);
  let made = 0;
  org.fetcher = async () => {
    made++;
    const key = `WB-${made}`;
    await new Promise((r) => setTimeout(r, 100));
    return Response.json({ key });
  };
  const send = () =>
    call(owner, {
      op: "org.jira.create",
      room,
      issues: [{ item: "task-1", summary: "Build" }],
    });
  const [first, second] = await Promise.all([send(), send()]);
  assert.equal(made, 1);
  assert.equal(first.created[0].key, "WB-1");
  assert.equal(second.created[0].key, "WB-1");
});

test("issues Jira already created are returned when a later one fails", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: {
      integrations: {
        jira: {
          enabled: true,
          site: "cds.atlassian.net",
          email: "svc@cds-snc.ca",
          project: "WB",
        },
      },
    },
    secrets: { jira: "token" },
  });
  const { input, room } = createInput("Plan");
  await boards.call(owner, input);
  let n = 0;
  org.fetcher = async () => {
    n++;
    if (n === 3)
      throw Object.assign(Error("timed out"), { name: "TimeoutError" });
    if (n === 4) return Response.json({ errors: {} }, { status: 400 });
    return Response.json({ key: `WB-${n}` });
  };
  const { created } = await call(owner, {
    op: "org.jira.create",
    room,
    issues: [1, 2, 3, 4, 5].map((k) => ({ item: `i${k}`, summary: `T${k}` })),
  });
  assert.deepEqual(
    created.map((c) => c.key || c.error),
    [
      "WB-1",
      "WB-2",
      "Could not reach Jira.",
      "Jira did not accept the request.",
      "WB-5",
    ],
  );
  assert.equal(created[3].status, 400);
});

test("API keys: use never rewrites them and expiry must be valid", async () => {
  const { call, org, env } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { key, record } = await call(owner, {
    op: "apikeys.create",
    name: "IdP",
    scopes: ["scim"],
  });
  const writes = [];
  const set = org.kv.set.bind(org.kv);
  org.kv.set = (k, ...rest) => (writes.push(k), set(k, ...rest));
  await apiKey(org, key, "scim");
  org.kv.set = set;
  assert.ok(writes.every((k) => !k.startsWith("org:apikey:")));
  const { keys } = await call(owner, { op: "apikeys.list" });
  assert.equal(keys.find((k) => k.id === record.id).lastUsed, env.now);
  await call(owner, { op: "apikeys.revoke", id: record.id });
  await assert.rejects(apiKey(org, key, "scim"), { status: 401 });
  for (const days of ["30d", -5, 0, 1.5])
    await assert.rejects(
      call(owner, { op: "apikeys.create", scopes: ["scim"], days }),
      { status: 400 },
    );
  const capped = await call(owner, {
    op: "apikeys.create",
    scopes: ["scim"],
    days: 1000,
  });
  assert.equal(capped.record.expires, env.now + 730 * 86_400_000);
});

test("verifying an address keeps a board removal and a higher role", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const rooms = [];
  for (const title of ["Removed", "Promoted"]) {
    const { input, room } = createInput(title);
    await boards.call(owner, input);
    await boards.call(owner, {
      op: "settings",
      room,
      visibility: "organization",
    });
    await call(owner, {
      op: "migration.apply",
      room,
      members: [{ email: "vic@cds-snc.ca", role: "editor" }],
    });
    rooms.push(room);
  }
  const [removed, promoted] = rooms;
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(viewer, { op: "org.join", token });
  for (const room of rooms) await boards.call(viewer, { op: "join", room });
  await boards.call(owner, {
    op: "role",
    room: removed,
    uuid: viewer.uuid,
    role: "removed",
  });
  await boards.call(owner, {
    op: "role",
    room: promoted,
    uuid: viewer.uuid,
    role: "facilitator",
  });
  await call(viewer, { op: "email.start", email: "vic@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  await call(viewer, { op: "email.confirm", code });
  const member = (room) => org.kv.get(`wb:${room}:member:${viewer.uuid}`);
  assert.equal((await member(removed)).role, "removed");
  assert.equal((await member(promoted)).role, "facilitator");
  assert.equal(await org.kv.get(`org:ub:${viewer.uuid}:${removed}`), null);
  assert.equal(
    await org.kv.get(`org:ub:${viewer.uuid}:${promoted}`),
    "facilitator",
  );
  await assert.rejects(boards.call(viewer, { op: "join", room: removed }), {
    status: 403,
  });
});

test("webhook deliveries are always signed, and deleted webhooks get none", async () => {
  const { call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { webhook } = await call(owner, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/wb",
  });
  const entry = { id: "e1", action: "user.joined", time: "t" };
  // Another instance still lists the webhook after it was deleted.
  await call(owner, { op: "webhooks.delete", id: webhook.id });
  const before = fetched.length;
  await sendHook(org, webhook, entry);
  assert.equal(fetched.length, before, "Nothing is sent");
  // A webhook whose secret is not saved yet is tried again later.
  await org.kv.set("org:webhook:" + webhook.id, webhook);
  await assert.rejects(sendHook(org, webhook, entry));
  assert.equal(fetched.length, before);
});

test("each person's daily activity mark expires; the day's count stays", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  await org.touch(editor);
  const today = new Date(org.now()).toISOString().slice(0, 10);
  assert.equal(
    org.kv.expiries.get(`org:dayuser:${today}:${editor.uuid}`),
    172800,
  );
  assert.equal(org.kv.expiries.has(`org:daycount:${today}`), false);
  assert.equal(await org.kv.get(`org:daycount:${today}`), 1);
});

test("changes made on another instance are never written over by a cached copy", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  // This instance caches the member as active; another deactivates them.
  assert.equal((await org.user(editor.uuid)).status, "active");
  const stored = await org.kv.get("org:user:" + editor.uuid);
  await org.kv.set("org:user:" + editor.uuid, {
    ...stored,
    status: "deactivated",
  });
  await call(owner, {
    op: "teams.create",
    name: "Design",
    members: [editor.uuid],
  });
  const saved = await org.kv.get("org:user:" + editor.uuid);
  assert.equal(saved.status, "deactivated");
  assert.equal(saved.teams.length, 1);
});

test("a new invitation lets a guest whose access expired back in", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, { op: "org.policy.set", policy: { guestExpiryDays: 1 } });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const first = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
    guest: true,
  });
  await join({ service: boards }, guest, { room, token: first.token });
  const start = Date.now();
  boards.now = org.now = () => start + 2 * 86_400_000;
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    message: /guest access to this board has expired/,
  });
  // The old invitation cannot renew access; a new one can.
  await assert.rejects(
    join({ service: boards }, guest, { room, token: first.token }),
    { status: 403 },
  );
  const again = await boards.call(owner, {
    op: "invite",
    room,
    role: "viewer",
    guest: true,
  });
  const joined = await join({ service: boards }, guest, {
    room,
    token: again.token,
  });
  assert.equal(joined.member.role, "viewer");
  await boards.call(guest, { op: "sync", room });
  // The renewed access expires again with the policy.
  boards.now = org.now = () => start + 5 * 86_400_000;
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    status: 403,
  });
});

test("the shared board map accepts only its title and planning settings", async () => {
  const { boards } = setup();
  const { input, room } = createInput();
  await boards.call(owner, input);
  const inv = await boards.call(owner, {
    op: "invite",
    room,
    role: "commenter",
  });
  await boards.call(viewer, { op: "join", room, token: inv.token });
  for (const [user, change] of [
    [viewer, (meta) => meta.set("junk", "x".repeat(100_000))],
    [owner, (meta) => meta.set("planning", ["not", "plain"])],
  ]) {
    const { doc } = await boards.load(room);
    const before = doc.vector();
    change(doc.meta);
    const update = doc.update(before);
    doc.destroy();
    await assert.rejects(
      boards.call(user, {
        op: "commit",
        room,
        id: await hash(update),
        update: encode(update),
      }),
      { status: 422 },
    );
  }
  const { doc } = await boards.load(room);
  assert.deepEqual([...doc.meta.keys()], ["title"]);
  doc.destroy();
});

test("invitations stop working when their creator can no longer manage the board", async () => {
  const { boards } = setup();
  const { input, room } = createInput();
  await boards.call(owner, input);
  const promote = await boards.call(owner, {
    op: "invite",
    room,
    role: "facilitator",
  });
  await join({ service: boards }, editor, { room, token: promote.token });
  const theirs = await boards.call(editor, {
    op: "invite",
    room,
    role: "editor",
  });
  const second = await boards.call(editor, {
    op: "invite",
    room,
    role: "viewer",
  });
  await join({ service: boards }, viewer, { room, token: second.token });
  await boards.call(owner, {
    op: "role",
    room,
    uuid: editor.uuid,
    role: "removed",
  });
  await assert.rejects(
    join({ service: boards }, guest, { room, token: theirs.token }),
    { status: 403, message: /expired or was revoked/ },
  );
  // People who already joined keep their access.
  await boards.call(viewer, { op: "sync", room });
  // The owner's own invitations still work.
  const ownerInvite = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await join({ service: boards }, guest, { room, token: ownerInvite.token });
});

test("the administrator running a migration keeps the role they had in Miro", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  await call(owner, { op: "email.start", email: "alice@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  await call(owner, { op: "email.confirm", code });
  const member = (room) => org.kv.get(`wb:${room}:member:${owner.uuid}`);
  for (const [members, expected] of [
    [
      [
        { email: "bob@cds-snc.ca", role: "owner", name: "Bob" },
        { email: "alice@cds-snc.ca", role: "editor", name: "Alice" },
      ],
      "editor",
    ],
    // Not a member there: governance access only.
    [[{ email: "bob@cds-snc.ca", role: "owner", name: "Bob" }], "removed"],
  ]) {
    const { input, room } = createInput("From Miro");
    await boards.call(owner, input);
    await call(owner, { op: "migration.apply", room, members });
    assert.equal((await member(room)).role, expected);
  }
});

test("turning off guest access ends access for guests already on boards", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const inv = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
    guest: true,
  });
  await join({ service: boards }, guest, { room, token: inv.token });
  await boards.call(guest, { op: "sync", room });
  await call(owner, { op: "org.policy.set", policy: { guestAccess: false } });
  org.forgetPolicy();
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    status: 403,
    message: /does not allow guest access/,
  });
  await boards.call(owner, { op: "sync", room });
  await call(owner, { op: "org.policy.set", policy: { guestAccess: true } });
  org.forgetPolicy();
  await boards.call(guest, { op: "sync", room });
});

test("guest expiry also applies to members made guests later", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, { op: "org.policy.set", policy: { guestExpiryDays: 1 } });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const inv = await boards.call(owner, { op: "invite", room, role: "editor" });
  await join({ service: boards }, editor, { room, token: inv.token });
  const start = Date.now();
  // Months later, the member becomes a guest; their day starts then.
  boards.now = org.now = () => start + 100 * 86_400_000;
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    role: "guest",
  });
  org.forgetUser(editor.uuid);
  await boards.call(editor, { op: "sync", room });
  boards.now = org.now = () => start + 102 * 86_400_000;
  await assert.rejects(boards.call(editor, { op: "sync", room }), {
    status: 403,
    message: /guest access to this board has expired/,
  });
  // Members, and boards before the organization was set up, are unaffected.
  await boards.call(owner, { op: "sync", room });
});

test("an administrator invitation works for one person", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "admin" });
  await call(editor, { op: "org.join", token });
  assert.equal(await org.role(editor), "admin");
  await assert.rejects(call(viewer, { op: "org.join", token }), {
    status: 403,
    message: /already used/,
  });
  assert.equal(await org.role(viewer), null);
  // The person it admitted can follow it again.
  await call(editor, { op: "org.join", token });
  // Member links still admit a whole team.
  const team = await call(owner, { op: "org.invite", role: "member" });
  for (const user of [viewer, guest])
    await call(user, { op: "org.join", token: team.token });
  assert.equal(await org.role(guest), "member");
  // Two people following a new administrator link at the same moment:
  // only one becomes an administrator.
  const admin = await call(owner, { op: "org.invite", role: "admin" });
  const other = {
    uuid: "55555555-5555-4555-8555-555555555555",
    username: "Eve",
  };
  const results = await Promise.allSettled([
    call(viewer, { op: "org.join", token: admin.token }),
    call(other, { op: "org.join", token: admin.token }),
  ]);
  // Either can be first: the hashes each request computes finish in no
  // set order.
  assert.deepEqual(results.map((r) => r.status).sort(), [
    "fulfilled",
    "rejected",
  ]);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /already used/,
  );
  const first = results[0].status === "fulfilled";
  assert.equal(await org.role(viewer), first ? "admin" : "member");
  assert.equal(await org.role(other), first ? null : "admin");
});

test("a board that kept a public link saves its settings after links are turned off", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { publicLinks: true, externalSharing: "anyone" },
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await boards.call(owner, { op: "settings", room, visibility: "link" });
  await call(owner, { op: "org.policy.set", policy: { publicLinks: false } });
  org.forgetPolicy();
  await boards.call(owner, {
    op: "settings",
    room,
    visibility: "link",
    orgRole: "viewer",
  });
  assert.equal((await org.kv.get(`wb:${room}:meta`)).orgRole, "viewer");
  // Turning a public link on is still refused.
  const other = createInput("Other");
  await boards.call(owner, other.input);
  await assert.rejects(
    boards.call(owner, {
      op: "settings",
      room: other.room,
      visibility: "link",
    }),
    { status: 403 },
  );
});

test("creating and deleting spaces is audited", async () => {
  const { call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { space } = await call(owner, { op: "spaces.create", name: "Policy" });
  await call(owner, { op: "spaces.delete", id: space.id });
  const { entries } = await call(owner, { op: "org.audit" });
  const spaces = entries.filter((e) => e.target?.type === "space");
  assert.deepEqual(
    spaces.map((e) => [e.action, e.target.name, e.category]).sort(),
    [
      ["space.created", "Policy", "admin"],
      ["space.deleted", "Policy", "admin"],
    ],
  );
});

test("the board directory pages through matching boards", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const title of ["One", "Two", "Three"]) {
    const { input } = createInput(title);
    await boards.call(owner, input);
  }
  const first = await call(owner, { op: "org.boards", scope: "all", limit: 2 });
  assert.equal(first.boards.length, 2);
  assert.equal(first.total, 3);
  const rest = await call(owner, {
    op: "org.boards",
    scope: "all",
    limit: 2,
    offset: 2,
  });
  assert.equal(rest.boards.length, 1);
  assert.equal(
    new Set([...first.boards, ...rest.boards].map((b) => b.room)).size,
    3,
  );
});

test("security alerts read the administrator list once a minute", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { externalSharing: "anyone", publicLinks: true },
  });
  const { token } = await call(owner, { op: "org.invite", role: "admin" });
  await call(editor, { op: "org.join", token });
  const listed = [];
  const list = org.list.bind(org);
  org.list = (prefix, ...rest) => (listed.push(prefix), list(prefix, ...rest));
  for (const title of ["One", "Two"]) {
    const { input, room } = createInput(title);
    await boards.call(owner, input);
    await boards.call(owner, { op: "settings", room, visibility: "link" });
    await org.flush();
  }
  org.list = list;
  assert.equal(listed.filter((p) => p === "org:user:").length, 1);
  const alerts = (
    await call(editor, { op: "notifications.list" })
  ).items.filter(
    (n) => n.type === "alert" && n.action === "board.visibility.link",
  );
  assert.equal(alerts.length, 2, "Administrators still get every alert");
});

test("every ownership transfer goes only to an active member", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const guestLink = await call(owner, { op: "org.invite", role: "guest" });
  await call(guest, { op: "org.join", token: guestLink.token });
  const team = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token: team.token });
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Admin",
    scopes: ["boards:write"],
  });
  const patch = (body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/v1/boards/" + room, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${key}` },
      }),
      "PATCH",
      "boards/" + room,
      body,
    );
  for (const target of [guest, editor])
    await assert.rejects(patch({ owner: target.uuid }), { status: 400 });
  assert.equal((await org.kv.get(`wb:${room}:meta`)).owner, owner.uuid);
  // A refused request changes nothing, even what it asked for before the
  // refused part.
  await assert.rejects(patch({ archived: true, visibility: "bogus" }), {
    status: 400,
  });
  await assert.rejects(patch({ archived: true, owner: guest.uuid }), {
    status: 400,
  });
  assert.ok(!(await org.kv.get(`wb:${room}:meta`)).archived);
  // Refusals that depend on the organization's policy or a hold, too.
  const colleague = await call(owner, { op: "org.invite", role: "member" });
  await call(viewer, { op: "org.join", token: colleague.token });
  await assert.rejects(patch({ owner: viewer.uuid, visibility: "link" }), {
    status: 403,
  });
  await assert.rejects(patch({ legalHold: true, deleted: true }), {
    status: 409,
  });
  await call(owner, {
    op: "org.policy.set",
    policy: { retention: { legalHold: true } },
  });
  await assert.rejects(patch({ archived: true, deleted: true }), {
    status: 409,
  });
  const meta = await org.kv.get(`wb:${room}:meta`);
  assert.equal(meta.owner, owner.uuid);
  assert.ok(!meta.archived && !meta.legalHold && !meta.deleted);
  // A request that releases a board's own hold may delete it.
  await call(owner, {
    op: "org.policy.set",
    policy: { retention: { legalHold: false } },
  });
  await patch({ legalHold: true });
  await patch({ legalHold: false, deleted: true });
  assert.ok((await org.kv.get(`wb:${room}:meta`)).deleted);
});

test("SCIM lookups and group changes read only the people involved", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Entra",
    scopes: ["scim"],
  });
  const scim = (path, method = "GET", body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path.split("?")[0],
      body,
    );
  const people = [];
  for (let n = 0; n < 300; n++)
    people.push(
      await (
        await scim("Users", "POST", { userName: `p${n}@cds-snc.ca` })
      ).json(),
    );
  const group = await (
    await scim("Groups", "POST", { displayName: "Team" })
  ).json();
  const listed = [];
  const list = org.list.bind(org);
  org.list = (prefix, ...rest) => (listed.push(prefix), list(prefix, ...rest));
  const found = await (
    await scim(
      `Users?filter=${encodeURIComponent('userName eq "p7@cds-snc.ca"')}`,
    )
  ).json();
  const missing = await (
    await scim(
      `Users?filter=${encodeURIComponent('userName eq "new@cds-snc.ca"')}`,
    )
  ).json();
  await scim("Groups/" + group.id, "PATCH", {
    schemas: [PATCH_OP],
    Operations: [
      { op: "add", path: "members", value: [{ value: people[3].id }] },
    ],
  });
  const read = await (await scim("Groups/" + group.id)).json();
  org.list = list;
  assert.equal(found.totalResults, 1);
  assert.equal(found.Resources[0].id, people[7].id);
  assert.equal(missing.totalResults, 0);
  assert.deepEqual(read.members, [{ value: people[3].id }]);
  assert.ok(!listed.includes("org:user:"), listed.join());
});

test("SCIM changes reach webhooks and the default SIEM categories", async () => {
  const { boards, call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { webhooks: { enabled: true } } },
  });
  const { webhook } = await call(owner, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/scim",
    events: ["scim"],
  });
  assert.deepEqual(webhook.events, ["scim"]);
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Entra",
    scopes: ["scim"],
  });
  const scim = (path, method, body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path,
      body,
    );
  const user = await (
    await scim("Users", "POST", { userName: "bob@cds-snc.ca" })
  ).json();
  await scim("Users/" + user.id, "PATCH", {
    schemas: [PATCH_OP],
    Operations: [{ op: "replace", path: "active", value: false }],
  });
  await org.flush();
  const events = fetched
    .filter((f) => f.url === webhook.url)
    .map((f) => JSON.parse(f.options.body).event);
  assert.ok(events.includes("scim.user.updated"), events.join());
  for (const action of ["scim.user.updated", "scim.group.created"])
    assert.equal(auditCategory(action), "admin");
});

test("comments are board content, exported to a SIEM only when content is", () => {
  assert.equal(auditCategory("board.comment.created"), "content");
  const categories = normalizePolicy().siem.categories;
  assert.ok(!categories.includes(auditCategory("board.comment.created")));
});

test("parallel verification requests share the hourly email limit", async () => {
  const { call, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "guest" });
  await call(guest, { op: "org.join", token });
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, () =>
      call(guest, { op: "email.start", email: "someone@example.org" }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
  assert.equal(sent.length, 5);
  await assert.rejects(
    call(guest, { op: "email.start", email: "someone@example.org" }),
    { status: 429 },
  );
});

test("changing a verified email frees the previous address", async () => {
  const { call, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const user of [editor, viewer]) {
    const { token } = await call(owner, { op: "org.invite", role: "member" });
    await call(user, { op: "org.join", token });
  }
  const verify = async (user, email) => {
    await call(user, { op: "email.start", email });
    const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
    return call(user, { op: "email.confirm", code });
  };
  await verify(editor, "inbox@cds-snc.ca");
  await verify(editor, "bob@cds-snc.ca");
  const { user } = await verify(viewer, "inbox@cds-snc.ca");
  assert.equal(user.email, "inbox@cds-snc.ca");
  await assert.rejects(verify(viewer, "bob@cds-snc.ca"), { status: 409 });
});

test("only the board owner or an administrator connects a board to Slack", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "facilitator",
  });
  await join({ service: boards }, editor, { room, token });
  const hook = "https://hooks.slack.com/services/T/B/x";
  await assert.rejects(
    boards.call(editor, { op: "settings", room, slack: hook }),
    { status: 403 },
  );
  const asFacilitator = await boards.call(editor, {
    op: "settings.get",
    room,
  });
  assert.equal(asFacilitator.settings.integrations, false);
  await boards.call(owner, { op: "settings", room, slack: hook });
  const { settings } = await boards.call(owner, { op: "settings.get", room });
  assert.equal(settings.slack, true);
  assert.equal(settings.integrations, true);
  await boards.call(owner, { op: "settings", room, slack: "" });
  assert.equal(await org.kv.get("org:boardslack:" + room), null);
  const { entries } = await call(owner, {
    op: "org.audit",
    action: "board.share.slack",
  });
  assert.deepEqual(entries.map((e) => e.details.connected).sort(), [
    false,
    true,
  ]);
});

test("the SIEM token is never sent to a new endpoint without being re-entered", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const siem = (url) => ({ siem: { mode: "https", url } });
  await call(owner, {
    op: "org.policy.set",
    policy: siem("https://siem.cds-snc.ca/in"),
    secrets: { "siem-token": "secret" },
  });
  // Another path on the same host keeps the token.
  await call(owner, {
    op: "org.policy.set",
    policy: siem("https://siem.cds-snc.ca/v2"),
  });
  await assert.rejects(
    call(owner, {
      op: "org.policy.set",
      policy: siem("https://attacker.example/collect"),
    }),
    { status: 400 },
  );
  assert.equal((await org.policy()).siem.url, "https://siem.cds-snc.ca/v2");
  await call(owner, {
    op: "org.policy.set",
    policy: siem("https://siem2.cds-snc.ca/in"),
    secrets: { "siem-token": "new" },
  });
  assert.equal(await org.secret("siem-token"), "new");
  // A token field that is not text replaces nothing, so it is no new token.
  for (const value of [true, 1, {}])
    await assert.rejects(
      call(owner, {
        op: "org.policy.set",
        policy: siem("https://attacker.example/collect"),
        secrets: { "siem-token": value },
      }),
      { status: 400 },
    );
  assert.equal((await org.policy()).siem.url, "https://siem2.cds-snc.ca/in");
  // Clearing the endpoint sends the token nowhere, so it needs no token.
  await call(owner, {
    op: "org.policy.set",
    policy: { siem: { mode: "none", url: "" } },
  });
  assert.equal((await org.policy()).siem.url, "");
});

test("the SIEM endpoint must be a public internet address", async () => {
  const { call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const url of [
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/in",
    "https://localhost/in",
  ])
    await assert.rejects(
      call(owner, {
        op: "org.policy.set",
        policy: { siem: { mode: "https", url } },
      }),
      { status: 400 },
    );
  // An endpoint saved before this check is refused when sending.
  const meta = await org.kv.get("org:meta");
  meta.policy.siem = {
    ...meta.policy.siem,
    mode: "https",
    url: "https://169.254.169.254/latest/meta-data/",
  };
  await org.kv.set("org:meta", meta);
  await assert.rejects(call(owner, { op: "org.siem.test" }));
  assert.ok(!fetched.some((f) => f.url.includes("169.254")));
});

test("webhooks only go to public internet addresses", async () => {
  const { call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const url of [
    "https://127.0.0.1:8443/admin",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://localhost/",
    "https://api.internal/",
    "https://0x7f.1/",
    // IPv6 addresses carrying a private IPv4 address.
    "https://[2002:7f00:1::]/",
    "https://[2002:a9fe:a9fe::]/",
    "https://[2001:0:4136:e378::]/",
  ])
    await assert.rejects(call(owner, { op: "webhooks.create", url }), {
      status: 400,
    });
  const { webhook } = await call(owner, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/wb",
  });
  assert.equal(webhook.url, "https://hooks.example.ca/wb");
  await call(owner, {
    op: "webhooks.create",
    url: "https://[2606:4700::1111]/wb",
  });
});

test("CSV exports neutralize spreadsheet formulas", async () => {
  const { toCSV: adminCSV } = await import("../src/organization/admin-ui.js");
  for (const csv of [toCSV, adminCSV]) {
    const out = csv(
      [{ a: '=HYPERLINK("https://x")', b: "@SUM(1)", c: -4, d: "plain" }],
      ["a", "b", "c", "d"],
    );
    assert.equal(
      out.split("\r\n")[1],
      `"'=HYPERLINK(""https://x"")",'@SUM(1),-4,plain`,
    );
  }
});

test("admin CSV exports name computed columns in the header", async () => {
  const { toCSV: adminCSV } = await import("../src/organization/admin-ui.js");
  const out = adminCSV(
    [{ username: "ann", lastActive: 1 }],
    [
      "username",
      [
        "lastActive",
        (u) => u.lastActive && new Date(u.lastActive).toISOString(),
      ],
    ],
  );
  assert.deepEqual(out.slice(1).split("\r\n"), [
    "username,lastActive",
    "ann,1970-01-01T00:00:00.001Z",
  ]);
});

test("the owner verifying an email is not counted as a guest member", async () => {
  const { call, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, { op: "email.start", email: "alice@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  // Email is in both official languages, English first.
  assert.match(sent.at(-1).subject, /verification code \/ Votre code/);
  assert.match(
    sent.at(-1).text,
    /\n---\n\nVotre code de vérification est \d{6}/,
  );
  const { info } = await call(owner, { op: "email.confirm", code });
  assert.equal(info.role, "owner");
  assert.equal(info.user.emailVerified, true);
  const { users } = await call(owner, { op: "org.users.list" });
  assert.deepEqual(users, []);
  const report = await call(owner, { op: "org.reports" });
  assert.equal(report.users.total, 1);
  assert.equal(report.users.guests, 0);
});

test("a SCIM demotion when provisioning outlasts older invitations", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  await org.saveUser({
    ...(await org.user(editor.uuid)),
    email: "bob@cds-snc.ca",
    emailVerified: true,
  });
  await org.kv.set("org:email:" + (await hash("bob@cds-snc.ca")), editor.uuid);
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Entra",
    scopes: ["scim"],
  });
  let now = Date.now() + 60_000;
  org.now = () => now;
  await restRoute(
    org,
    boards,
    new Request("https://w.puter.work/scim/v2/Users", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    }),
    "POST",
    "Users",
    { userName: "bob@cds-snc.ca", roles: [{ value: "guest" }] },
  );
  assert.equal(await org.role(editor), "guest");
  now += 1000;
  await call(editor, { op: "org.join", token });
  assert.equal(await org.role(editor), "guest");
  // Once deleted, the account cannot be put back into groups by its id.
  const send = (method, path, body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path,
      body,
    );
  await send("DELETE", "Users/" + editor.uuid);
  const group = await (
    await send("POST", "Groups", {
      displayName: "Design",
      members: [{ value: editor.uuid }],
    })
  ).json();
  assert.deepEqual(group.members, []);
});

test("SCIM finds the account owner but never deactivates them", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  await call(owner, { op: "email.start", email: "alice@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  await call(owner, { op: "email.confirm", code });
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Entra",
    scopes: ["scim"],
  });
  const scim = (path, method = "GET", body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path.split("?")[0],
      body,
    );
  const created = await (
    await scim("Users", "POST", { userName: "alice@cds-snc.ca", active: true })
  ).json();
  assert.equal(created.roles[0].value, "owner");
  // Discovery answers for one resource type, and lists them all.
  assert.equal(
    (await (await scim("ResourceTypes/User")).json()).endpoint,
    "/Users",
  );
  assert.equal((await (await scim("ResourceTypes")).json()).totalResults, 2);
  await assert.rejects(scim("ResourceTypes/Nope"), { status: 404 });
  const found = await (
    await scim("Users?filter=userName%20eq%20%22alice@cds-snc.ca%22")
  ).json();
  assert.equal(found.totalResults, 1);
  await assert.rejects(
    scim("Users/" + created.id, "PATCH", {
      schemas: [PATCH_OP],
      Operations: [{ op: "replace", path: "active", value: false }],
    }),
    { status: 400, scimType: "mutability" },
  );
  await assert.rejects(scim("Users/" + created.id, "DELETE"), { status: 400 });
  // Names still follow the provider.
  const renamed = await (
    await scim("Users/" + created.id, "PATCH", {
      schemas: [PATCH_OP],
      Operations: [{ op: "replace", path: "displayName", value: "Alice A" }],
    })
  ).json();
  assert.equal(renamed.displayName, "Alice A");
  assert.equal(renamed.active, true);
  assert.equal(await org.role(owner), "owner");
});

test("only a SCIM key the account owner created changes an administrator's status", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const user of [editor, viewer]) {
    const { token } = await call(owner, { op: "org.invite", role: "member" });
    await call(user, { op: "org.join", token });
  }
  for (const uuid of [editor.uuid, viewer.uuid])
    await call(owner, { op: "org.users.update", uuid, role: "admin" });
  await call(owner, {
    op: "org.users.update",
    uuid: viewer.uuid,
    role: "member",
  });
  const keyOf = async (by) =>
    (await call(by, { op: "apikeys.create", name: "IdP", scopes: ["scim"] }))
      .key;
  const scim = (key, path, method, body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path,
      body,
    );
  const deactivate = {
    schemas: [PATCH_OP],
    Operations: [{ op: "replace", path: "active", value: false }],
  };
  // Another administrator's key cannot deactivate or delete an administrator.
  const adminKey = await keyOf(editor);
  const other = { uuid: "55555555-5555-4555-8555-555555555555" };
  await org.saveUser({
    uuid: other.uuid,
    username: "Eve",
    role: "admin",
    status: "active",
    teams: [],
  });
  await assert.rejects(
    scim(adminKey, "Users/" + other.uuid, "PATCH", deactivate),
    {
      status: 403,
    },
  );
  await assert.rejects(
    scim(adminKey, "Users/" + other.uuid, "PUT", { active: false }),
    { status: 403 },
  );
  await assert.rejects(scim(adminKey, "Users/" + other.uuid, "DELETE"), {
    status: 403,
  });
  assert.equal((await org.user(other.uuid)).status, "active");
  // Changes that leave the status alone, and members, still sync.
  const renamed = await (
    await scim(adminKey, "Users/" + other.uuid, "PUT", {
      displayName: "Eve A",
      active: true,
    })
  ).json();
  assert.equal(renamed.displayName, "Eve A");
  await scim(adminKey, "Users/" + viewer.uuid, "PATCH", deactivate);
  assert.equal((await org.user(viewer.uuid)).status, "deactivated");
  // The owner's key deprovisions administrators who leave.
  const ownerKey = await keyOf(owner);
  await scim(ownerKey, "Users/" + other.uuid, "PATCH", deactivate);
  assert.equal((await org.user(other.uuid)).status, "deactivated");
  await scim(ownerKey, "Users/" + editor.uuid, "DELETE");
  assert.equal(await org.role(editor), null);
});

test("notification emails are in both official languages", async () => {
  const { call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await org.saveUser({
    uuid: editor.uuid,
    username: "Bob",
    role: "member",
    status: "active",
    email: "bob@cds-snc.ca",
    emailVerified: true,
    teams: [],
  });
  await org.notify(editor.uuid, {
    type: "assignment",
    board: "room",
    boardTitle: "Sprint",
    actor: { uuid: owner.uuid, username: "Alice" },
    title: "Write the brief",
    due: "2026-10-01",
  });
  await org.flush();
  const message = sent.at(-1);
  assert.equal(
    message.subject,
    "Alice assigned you a task on Sprint / Alice vous a assigné une tâche dans Sprint",
  );
  assert.match(
    message.text,
    /^\(Le français suit\.\)\n\nAlice: Write the brief \(due 2026-10-01\)\n\n---\n\nAlice : Write the brief \(échéance le 2026-10-01\)$/,
  );
  // Several tasks given in one edit arrive as one message.
  for (const more of [1, 4]) {
    await org.notify(editor.uuid, {
      type: "assignment",
      board: "room",
      boardTitle: "Sprint",
      actor: { uuid: owner.uuid, username: "Alice" },
      title: "Write the brief",
      more,
    });
    await org.flush();
  }
  assert.equal(
    sent.at(-1).subject,
    "Alice assigned you tasks on Sprint / Alice vous a assigné des tâches dans Sprint",
  );
  assert.match(sent.at(-2).text, /Write the brief and 1 more\n/);
  assert.match(sent.at(-2).text, /Write the brief et 1 autre$/);
  assert.match(sent.at(-1).text, /Write the brief et 4 autres$/);
  // A long board title leaves room for the French half of the subject.
  await org.notify(editor.uuid, {
    type: "mention",
    board: "room",
    boardTitle: "Q".repeat(150),
    actor: { uuid: owner.uuid, username: "Alice" },
    excerpt: "Look",
  });
  await org.flush();
  assert.match(sent.at(-1).subject, /Alice vous a mentionné dans Q+…$/);
});

test("security alert emails keep each language in its own half", async () => {
  const { call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: {
      alerts: { permissionChanges: true, emails: ["sec@cds-snc.ca"] },
    },
  });
  await org.flush();
  sent.length = 0;
  for (const name of ["first", "second"])
    await call(owner, { op: "apikeys.create", name, scopes: ["audit:read"] });
  await org.flush();
  const alert = sent.find((m) => m.subject.startsWith("Whiteboard security"));
  const [english, french] = alert.text.split("\n---\n");
  assert.equal(english.match(/An API key was created/g).length, 2);
  assert.doesNotMatch(english, /clé d’API/);
  assert.equal(french.match(/Une clé d’API a été créée/g).length, 2);
});

test("audit retention works through a backlog in several batches", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const old = Date.now() - 400 * 86_400_000;
  for (let n = 0; n < 25; n++) {
    const time = new Date(old + n).toISOString();
    await org.kv.set(`org:audit:${time}:${n}`, { id: `${time}:${n}`, time });
  }
  assert.deepEqual(await purge(org, { batch: 10, rounds: 2 }), {
    audit: 20,
    boards: 0,
    more: true,
  });
  const second = await purge(org, { batch: 10, rounds: 2 });
  assert.equal(second.audit, 5);
  assert.equal(second.more, false);
});

test("a large deleted board is purged over several quick runs", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  for (let n = 0; n < 30; n++)
    await org.kv.set(`wb:${room}:log:${String(n).padStart(4, "0")}`, { n });
  await boards.call(owner, { op: "delete", room });
  org.now = () => Date.now() + 40 * 86_400_000;
  let deletes = 0;
  const del = org.kv.del.bind(org.kv);
  org.kv.del = (key) => (deletes++, del(key));
  let runs = 0,
    result;
  do {
    deletes = 0;
    result = await purge(org, { budget: 10 });
    runs++;
    assert.ok(deletes <= 10 + 6, `${deletes} deletions in one run`);
  } while (result.more && runs < 20);
  org.kv.del = del;
  assert.ok(runs > 3, "The board took several runs");
  assert.equal(await org.kv.get("org:board:" + room), null);
  assert.deepEqual(await org.list(`wb:${room}:`), []);
  const purged = (await call(owner, { op: "org.audit" })).entries.filter(
    (e) => e.action === "board.purged",
  );
  assert.equal(purged.length, 1);
});

test("a board being purged can no longer be restored or held", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  for (let n = 0; n < 30; n++)
    await org.kv.set(`wb:${room}:log:${String(n).padStart(4, "0")}`, { n });
  await boards.call(owner, { op: "delete", room });
  const now = Date.now() + 40 * 86_400_000;
  org.now = boards.now = () => now;
  // Only the runs below purge; requests do not run housekeeping meanwhile.
  org.caches.purged = now;
  // The first run removes the board's earliest records and edits.
  assert.equal((await purge(org, { budget: 10 })).more, true);
  for (const op of ["restore", "hold"])
    await assert.rejects(boards.call(owner, { op, room, enabled: true }), {
      status: 409,
      message: "This board is being permanently deleted.",
    });
  const record = await org.kv.get("org:board:" + room);
  assert.ok(record.deleted);
  assert.equal(record.legalHold, false);
  let runs = 0;
  while ((await purge(org, { budget: 10 })).more && runs++ < 20);
  assert.equal(await org.kv.get("org:board:" + room), null);
  // A copy of the board read just before it was purged brings back none of
  // it.
  for (const op of ["restore", "hold"])
    await assert.rejects(boards.call(owner, { op, room, enabled: true }), {
      status: 404,
    });
  assert.equal(await org.kv.get("org:board:" + room), null);
  assert.deepEqual(await org.list(`wb:${room}:`), []);
});

test("deleting a board again keeps the time it went to the trash", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const start = Date.now();
  org.now = boards.now = () => start;
  await boards.call(owner, { op: "delete", room });
  org.now = boards.now = () => start + 29 * 86_400_000;
  await boards.call(owner, { op: "delete", room });
  assert.equal((await org.kv.get("org:board:" + room)).deleted, start);
  assert.equal((await org.kv.get(`wb:${room}:meta`)).deleted, start);
  const deletions = (await call(owner, { op: "org.audit" })).entries.filter(
    (e) => e.action === "board.deleted",
  );
  assert.equal(deletions.length, 1);
  // The retention period still counts from the first deletion.
  org.now = boards.now = () => start + 40 * 86_400_000;
  org.caches.purged = org.now();
  await purge(org);
  assert.equal(await org.kv.get("org:board:" + room), null);
});

test("a hold or restore made during a purge run keeps the board", async () => {
  for (const op of ["hold", "restore"]) {
    const { boards, call, org } = setup();
    await call(owner, { op: "org.setup", name: "CDS" });
    const { input, room } = createInput("Evidence");
    await boards.call(owner, input);
    await boards.call(owner, { op: "delete", room });
    const now = Date.now() + 40 * 86_400_000;
    org.now = boards.now = () => now;
    org.caches.purged = now;
    // The request lands after the run has read the board directory.
    const list = org.kv.list.bind(org.kv);
    let fired = false;
    org.kv.list = async (options) => {
      if (!fired && options.pattern === "org:audit:") {
        fired = true;
        await boards.call(owner, { op, room, enabled: true });
      }
      return list(options);
    };
    assert.equal((await purge(org)).boards, 0);
    org.kv.list = list;
    const record = await org.kv.get("org:board:" + room);
    assert.ok(record, op);
    assert.ok(!record.purging, op);
    assert.ok(await org.kv.get(`wb:${room}:meta`), op);
    // The board is not stuck being purged.
    await boards.call(owner, { op: "archive", room });
  }
});

test("board settings and governance keep changes made meanwhile", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  // A copy of the board's metadata read before the hold was placed.
  const stale = await org.kv.get(`wb:${room}:meta`);
  await boards.call(owner, { op: "hold", room, enabled: true });
  await boards.updateSettings(room, owner, stale, {
    visibility: "organization",
  });
  const meta = await org.kv.get(`wb:${room}:meta`);
  assert.equal(meta.legalHold, true);
  assert.equal(meta.visibility, "organization");
  const member = await org.kv.get(`wb:${room}:member:${owner.uuid}`);
  await assert.rejects(
    boards.govern(room, owner, stale, member, { op: "delete" }),
    { status: 409 },
  );
});

test("organization board lists read many boards in a few requests", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (let n = 0; n < 450; n++) {
    const room = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await org.registerBoard(room, {
      title: `Board ${n}`,
      visibility: "organization",
      owner: owner.uuid,
    });
    // One match early and one past the first 400 boards.
    await org.kv.set(
      "org:idx:" + room,
      n === 7 || n === 440 ? "needle text" : "other",
    );
  }
  let requests = 0;
  const { get, list } = org.kv;
  org.kv.get = (...args) => (requests++, get.apply(org.kv, args));
  org.kv.list = (...args) => (requests++, list.apply(org.kv, args));
  const { boards } = await call(owner, {
    op: "org.boards",
    scope: "organization",
    limit: 1000,
  });
  assert.equal(boards.length, 450);
  const found = await call(owner, {
    op: "org.boards",
    scope: "organization",
    query: "needle",
    content: true,
  });
  assert.deepEqual(found.boards.map((b) => b.title).sort(), [
    "Board 440",
    "Board 7",
  ]);
  // The test store pages 3 rows at a time; reading each board would take
  // well over 1,000 requests here.
  assert.ok(requests < 1000, `${requests} requests`);
  // A person's own boards are read one by one, not by listing everything.
  for (let n = 0; n < 60; n++) {
    const room = `00000000-0000-4000-8000-${String(n * 7).padStart(12, "0")}`;
    await org.kv.set(`org:ub:${editor.uuid}:${room}`, "editor");
    await org.kv.set(`wb:${room}:meta`, { owner: owner.uuid });
    await org.kv.set(`wb:${room}:member:${editor.uuid}`, {
      uuid: editor.uuid,
      role: "editor",
    });
  }
  const listed = [];
  org.kv.list = (options) => (
    listed.push(options.pattern),
    list.call(org.kv, options)
  );
  const mine = await call(editor, {
    op: "org.boards",
    scope: "mine",
    query: "needle",
    content: true,
  });
  assert.deepEqual(
    mine.boards.map((b) => b.title),
    ["Board 7"],
  );
  assert.ok(!listed.some((p) => /^org:(board|idx):/.test(p)), listed.join());
  org.kv.get = get;
  org.kv.list = list;
});

test("reports count every inactive member and only active accounts", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (let n = 0; n < 510; n++)
    await org.saveUser({
      uuid: `member-${n}`,
      username: `m${n}`,
      role: "member",
      status: "active",
      teams: [],
    });
  await org.saveUser({
    uuid: "gone",
    username: "gone",
    role: "member",
    status: "deactivated",
    lastActive: org.now(),
    teams: [],
  });
  const report = await call(owner, { op: "org.reports" });
  assert.equal(report.users.inactiveCount, 510);
  assert.equal(report.users.inactive.length, 510);
  assert.equal(report.users.activeLast30Days, 0, "deactivated not counted");
});

test("the inactive users export lists everyone past the report's first 5,000", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (let n = 0; n < 5003; n++)
    await org.saveUser({
      uuid: `member-${n}`,
      username: `m${n}`,
      role: "member",
      status: "active",
      teams: [],
    });
  const report = await call(owner, { op: "org.reports" });
  assert.equal(report.users.inactiveCount, 5003);
  assert.equal(report.users.inactive.length, 5000);
  const all = await call(owner, { op: "org.reports", allInactive: true });
  assert.equal(all.users.inactive.length, 5003);
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Reports",
    scopes: ["reports:read"],
  });
  const res = await restRoute(
    org,
    boards,
    new Request("https://w.puter.work/v1/reports/users.csv", {
      headers: { Authorization: `Bearer ${key}` },
    }),
    "GET",
    "reports/users.csv",
  );
  const lines = (await res.text()).trim().split("\n");
  assert.equal(lines.length, 5004, "a header and every inactive person");
});

test("the report email averages daily active users over full days", () => {
  const day = (value) => ({ date: "2026-09-01", value });
  const text = reportSummary({
    generated: Date.parse("2026-09-08T01:00:00Z"),
    days: 7,
    users: {
      active: 1,
      deactivated: 0,
      guests: 0,
      activeLast30Days: 1,
      inactive: [],
    },
    usage: { dailyActiveUsers: [...Array(6).fill(day(70)), day(1)] },
    boards: { total: 0, activeLast30Days: 0, stale: 0, empty: 0 },
    sharing: { organizationVisible: 0, publicLinks: 0, withGuests: 0 },
    sessions: { largest: [] },
  });
  assert.match(text, /Average daily active users \(6 full days\): 70/);
});

test("a scheduled report that fails to send is tried again", async () => {
  const { call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { reports: { schedule: "weekly", emails: ["ops@cds-snc.ca"] } },
  });
  const send = org.puter.email.sendTransactional;
  org.puter.email.sendTransactional = async () => {
    throw Error("Mail service unavailable");
  };
  await assert.rejects(sendScheduledReport(org));
  org.puter.email.sendTransactional = send;
  assert.equal(await sendScheduledReport(org), true);
  assert.match(sent.at(-1).subject || JSON.stringify(sent.at(-1)), /weekly/);
  assert.match(sent.at(-1).subject, /Rapport hebdomadaire/);
  assert.match(sent.at(-1).text, /Rapport de l’organisation Whiteboard/);
});

test("two worker instances send a scheduled report once", async () => {
  const { OrgService } = await import("../worker/org.js");
  const { call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { reports: { schedule: "weekly", emails: ["ops@cds-snc.ca"] } },
  });
  const before = sent.length;
  const results = await Promise.all([
    sendScheduledReport(new OrgService(org.puter)),
    sendScheduledReport(new OrgService(org.puter)),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(sent.length, before + 1);
});

test("restricting boards to members ends access for guests who joined", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
    guest: true,
  });
  await boards.call(guest, { op: "join", room, token });
  await boards.call(guest, { op: "sync", room });
  await call(owner, {
    op: "org.policy.set",
    policy: { restrictToOrganization: true },
  });
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    status: 403,
  });
  // A guest who joins the organization is a member, whatever the board
  // recorded when they first joined, and a member made a guest is not.
  await call(owner, {
    op: "org.users.update",
    uuid: guest.uuid,
    role: "member",
  });
  await boards.call(guest, { op: "sync", room });
  await call(owner, {
    op: "org.users.update",
    uuid: guest.uuid,
    role: "guest",
  });
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    status: 403,
  });
});

test("a SIEM test always delivers a siem.test record", async () => {
  const { call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { siem: { mode: "https", url: "https://siem.cds-snc.ca/in" } },
  });
  // Events are still waiting to be exported.
  await call(owner, { op: "org.siem.test" });
  const posted = fetched.filter((f) => f.url === "https://siem.cds-snc.ca/in");
  const actions = JSON.parse(posted.at(-1).options.body).events.map(
    (e) => e.Action ?? e.action,
  );
  assert.ok(actions.includes("siem.test"), actions.join());
});

test("a SIEM test needs a destination", async () => {
  const { call, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await assert.rejects(call(owner, { op: "org.siem.test" }), {
    message: /Choose a SIEM destination/,
  });
  assert.equal(fetched.length, 0);
});

test("an administrator invitation promotes an existing member", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const member = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token: member.token });
  const admin = await call(owner, { op: "org.invite", role: "admin" });
  const { user } = await call(editor, { op: "org.join", token: admin.token });
  assert.equal(user.role, "admin");
  assert.equal(await org.role(editor), "admin");
  const changes = (await org.list("org:audit:")).filter(
    (r) => r.value.action === "user.role.changed",
  );
  assert.deepEqual(changes.at(-1).value.details, {
    from: "member",
    to: "admin",
    source: "invite",
  });
  // A member invitation leaves an administrator as they are.
  await call(editor, { op: "org.join", token: member.token });
  assert.equal(await org.role(editor), "admin");
  // Reusing an invitation never undoes a later role change.
  let now = Date.now() + 60_000;
  org.now = () => now;
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    role: "member",
  });
  await call(editor, { op: "org.join", token: admin.token });
  assert.equal(await org.role(editor), "member");
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    role: "guest",
  });
  await call(editor, { op: "org.join", token: member.token });
  assert.equal(await org.role(editor), "guest");
  // A newer invitation still applies.
  now += 1000;
  const again = await call(owner, { op: "org.invite", role: "admin" });
  await call(editor, { op: "org.join", token: again.token });
  assert.equal(await org.role(editor), "admin");
});

test("audit export and search reach every record of a busy day", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const day = "2026-01-15";
  for (let n = 0; n < 5010; n++) {
    const id = `${day}T00:00:${String(n % 60).padStart(2, "0")}.000Z:${String(n).padStart(6, "0")}`;
    await org.kv.set("org:audit:" + id, {
      id,
      at: Date.parse(day),
      action: "board.joined",
      category: "board",
    });
  }
  org.now = () => Date.parse(day + "T12:00:00Z");
  const all = await unsentAudit(org, null, 6000);
  const cursor = all[4999].id;
  assert.equal((await unsentAudit(org, cursor)).length, 10);
  const oldest = await call(owner, {
    op: "org.audit",
    from: day,
    to: day + "T23:59:59.999Z",
    cursor: all[10].id,
    limit: 500,
  });
  assert.deepEqual(
    oldest.entries.map((e) => e.id),
    all
      .slice(0, 10)
      .map((e) => e.id)
      .reverse(),
  );
});

test("audit export and paging read little beyond the records they return", async () => {
  const { call, org, env } = setup();
  env.now = Date.parse("2026-09-26T00:00:01Z");
  await call(owner, { op: "org.setup", name: "CDS" });
  for (let n = 0; n < 1500; n++) {
    env.now += 20_000;
    await org.audit(owner, "team.updated", { type: "team", id: "t" });
  }
  org.pending.length = 0;
  let read = 0;
  const list = org.kv.list.bind(org.kv);
  org.kv.list = async (options) => {
    const page = await list(options);
    if (options.pattern.startsWith("org:audit:2")) read += page.items.length;
    return page;
  };
  const all = await unsentAudit(org, null, 2000);
  read = 0;
  assert.equal((await unsentAudit(org, all.at(-2).id)).length, 1);
  assert.ok(read < 20, `${read} rows read to export one record`);
  read = 0;
  let cursor = null,
    total = 0;
  do {
    const page = await call(owner, { op: "org.audit", limit: 100, cursor });
    total += page.entries.length;
    cursor = page.cursor;
  } while (cursor);
  assert.equal(total, 1501);
  assert.ok(read < total * 3, `${read} rows read for ${total} records`);
});

test("audit searches skip days before the oldest record", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  let lists = 0;
  const list = org.kv.list.bind(org.kv);
  org.kv.list = (options) => (lists++, list(options));
  const result = await call(owner, { op: "org.audit", from: "1970-01-01" });
  assert.ok(result.entries.some((e) => e.action === "org.created"));
  assert.ok(lists < 10, `${lists} list requests`);
});

test("webhook deliveries run in parallel and failures are retried", async () => {
  const { boards, call, org } = setup();
  let failing = true,
    inFlight = 0,
    overlapped = false,
    release;
  const sentTo = [],
    held = new Promise((resolve) => (release = resolve));
  org.fetcher = boards.fetcher = async (url, options) => {
    if (String(url).startsWith("https://hooks.example.ca/")) {
      sentTo.push(JSON.parse(options.body).event);
      inFlight++;
      if (inFlight > 1) {
        overlapped = true;
        release();
      }
      await held;
      inFlight--;
      return new Response("{}", { status: failing ? 500 : 200 });
    }
    return new Response("{}", { status: 200 });
  };
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { webhooks: { enabled: true } } },
  });
  await call(owner, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/a",
  });
  // A serial implementation must still settle so the overlap assertion can
  // fail. This timer is cleanup, not a performance threshold.
  const unblock = setTimeout(release, 5000);
  try {
    await boards.call(owner, createInput().input);
  } finally {
    clearTimeout(unblock);
    release();
  }
  assert.ok(sentTo.length > 1, "board creation sends several events");
  assert.equal(overlapped, true, "another delivery starts before the first settles");
  const queued = await org.list("org:hookq:");
  assert.equal(queued.length, sentTo.length);
  failing = false;
  org.now = () => Date.now() + 120_000;
  await org.audit(owner, "user.joined", { type: "user", id: owner.uuid });
  await org.flush();
  assert.equal((await org.list("org:hookq:")).length, 0);
});

test("an unreachable webhook never blocks retries to the others", async () => {
  const { call, org } = setup();
  let upFails = true;
  const delivered = [];
  org.fetcher = async (url, options) => {
    if (String(url) === "https://down.example.ca/")
      return new Response("", { status: 503 });
    if (String(url) === "https://up.example.ca/") {
      if (upFails) return new Response("", { status: 500 });
      delivered.push(JSON.parse(options.body).data.target.id);
    }
    return new Response("{}", { status: 200 });
  };
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { webhooks: { enabled: true } } },
  });
  // The unreachable receiver sorts first and builds a long queue.
  // Every webhook has a signing secret, as webhooks.create saves.
  const hook = async (id, url) => {
    await org.kv.set("org:hooksecret:" + id, "whsec_test");
    await org.kv.set("org:webhook:" + id, {
      id,
      url,
      events: ["user"],
      enabled: true,
    });
  };
  await hook("0000000000000000", "https://down.example.ca/");
  for (let n = 0; n < 25; n++)
    await org.audit(owner, "user.joined", { type: "user", id: "d" + n });
  await org.flush();
  await hook("ffffffffffffffff", "https://up.example.ca/");
  org.instance.hooks = null;
  await org.audit(owner, "user.joined", { type: "user", id: "early" });
  await org.flush();
  upFails = false;
  const start = Date.now();
  org.now = () => start + 120_000;
  await org.audit(owner, "user.joined", { type: "user", id: "late" });
  await org.flush();
  assert.deepEqual(delivered.sort(), ["early", "late"]);
  await call(owner, { op: "webhooks.delete", id: "0000000000000000" });
  assert.equal((await org.list("org:hookq:")).length, 0);
});

test("a failing webhook is tried six times in all", async () => {
  const { call, org } = setup();
  let sends = 0;
  org.fetcher = async (url) => {
    if (String(url) === "https://down.example.ca/") {
      sends++;
      return new Response("", { status: 503 });
    }
    return new Response("{}", { status: 200 });
  };
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { webhooks: { enabled: true } } },
  });
  await org.kv.set("org:hooksecret:0000000000000000", "whsec_test");
  await org.kv.set("org:webhook:0000000000000000", {
    id: "0000000000000000",
    url: "https://down.example.ca/",
    events: ["team"],
    enabled: true,
  });
  org.instance.hooks = null;
  const start = Date.now();
  await org.audit(owner, "team.created", { type: "team", id: "t" });
  await org.flush();
  for (let hour = 1; hour <= 10; hour++) {
    org.now = () => start + hour * 3600_000;
    await org.audit(owner, "user.joined", { type: "user", id: "u" + hour });
    await org.flush();
  }
  assert.equal(sends, 6);
  assert.equal((await org.list("org:hookq:")).length, 0);
});

test("changing a team rewrites only the people who joined or left it", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const members = [];
  for (let n = 0; n < 40; n++) {
    const uuid = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
    members.push(uuid);
    await org.saveUser({ uuid, role: "member", status: "active", teams: [] });
  }
  const { team } = await call(owner, {
    op: "teams.create",
    name: "Big",
    members: members.slice(0, 39),
  });
  let writes = 0;
  const set = org.kv.set.bind(org.kv);
  org.kv.set = (...args) => (writes++, set(...args));
  await call(owner, { op: "teams.update", id: team.id, members });
  org.kv.set = set;
  assert.ok(writes < 10, `${writes} writes`);
  org.forgetUser(members[39]);
  assert.deepEqual((await org.user(members[39])).teams, [team.id]);
  await call(owner, {
    op: "teams.update",
    id: team.id,
    members: members.slice(1),
  });
  org.forgetUser(members[0]);
  assert.deepEqual((await org.user(members[0])).teams, []);
});

test("a role change is audited even when live event cleanup fails", async () => {
  const { env, boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const invite = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await join(env, editor, { room, token: invite.token });
  await boards.call(editor, { op: "events", room });
  const fetcher = boards.fetcher;
  boards.fetcher = async (url, options = {}) => {
    if (options.method === "DELETE") throw Error("Timed out");
    return fetcher(url, options);
  };
  await boards.call(owner, {
    op: "role",
    room,
    uuid: editor.uuid,
    role: "removed",
  });
  const actions = (await org.list("org:audit:")).map((r) => r.value.action);
  assert.ok(actions.includes("board.role.changed"));
});

test("an interrupted organization setup registers earlier boards when retried", async () => {
  const { env, boards, call, org } = setup();
  const { input, room } = createInput("Old board");
  await boards.call(owner, input);
  await env.data.delete("org:board:" + room);
  const backfill = boards.backfillRegistry.bind(boards);
  boards.backfillRegistry = async () => {
    throw Error("Worker time limit");
  };
  await assert.rejects(call(owner, { op: "org.setup", name: "CDS" }));
  boards.backfillRegistry = backfill;
  await call(owner, { op: "org.setup", name: "CDS" });
  assert.equal((await org.kv.get("org:board:" + room))?.title, "Old board");
});

test("unarchiving a board through the API keeps it deleted", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput("Archive me");
  await boards.call(owner, input);
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "Boards",
    scopes: ["boards:write"],
  });
  const patch = (body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/v1/boards/" + room, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${key}` },
      }),
      "PATCH",
      "boards/" + room,
      body,
    );
  await patch({ archived: true });
  assert.ok((await org.kv.get("org:board:" + room)).archived);
  await boards.call(owner, { op: "delete", room });
  await patch({ archived: false });
  const record = await org.kv.get("org:board:" + room);
  assert.equal(record.archived, null);
  assert.ok(record.deleted, "the board stays deleted");
  await patch({ deleted: false });
  assert.equal((await org.kv.get("org:board:" + room)).deleted, null);
  // Keeping a board out of the trash leaves an archive in place.
  await patch({ archived: true, deleted: false });
  assert.ok((await org.kv.get("org:board:" + room)).archived);
  await patch({ deleted: false });
  assert.ok((await org.kv.get("org:board:" + room)).archived);
  // A board restored and archived at once ends up archived.
  await boards.call(owner, { op: "delete", room });
  await patch({ archived: true, deleted: false });
  const both = await org.kv.get("org:board:" + room);
  assert.ok(both.archived);
  assert.equal(both.deleted, null);
});

test("joining a deleted board records no membership", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { externalSharing: "anyone", publicLinks: true },
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await boards.call(owner, { op: "settings", room, visibility: "link" });
  await boards.call(owner, { op: "delete", room });
  await assert.rejects(boards.call(guest, { op: "join", room }), {
    status: 404,
  });
  assert.equal(await org.kv.get(`wb:${room}:member:${guest.uuid}`), null);
  assert.equal(await org.user(guest.uuid), null);
});

test("switching to an unreachable organization keeps the current one", async () => {
  const saved = new Map();
  const puter = {
    kv: {
      get: async (key) => saved.get(key),
      set: async (key, value) => saved.set(key, value),
    },
  };
  const organization = createOrganization({
    puter: () => puter,
    call: async (_puter, server) => {
      if (server.includes("broken")) throw Error("Unreachable");
      return { configured: true, name: "CDS", role: "member" };
    },
    deploy: async () => {},
  });
  await organization.use("https://cds.puter.work");
  await assert.rejects(organization.use("https://broken.puter.work"));
  assert.equal(organization.server, "https://cds.puter.work");
  assert.equal(organization.info.name, "CDS");
  assert.equal(saved.get(ORG_KEY).server, "https://cds.puter.work");
});

test("one edit notifies each person once and posts to the board's Slack once", async () => {
  const { boards, call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { slack: { enabled: true } } },
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  for (const user of [editor, viewer]) {
    const { token } = await boards.call(owner, {
      op: "invite",
      room,
      role: "editor",
    });
    await join({ service: boards }, user, { room, token });
  }
  const hook = "https://hooks.slack.com/services/T/B/x";
  await boards.call(owner, { op: "settings", room, slack: hook });
  const posts = () =>
    fetched
      .filter((f) => f.url === hook)
      .map((f) => JSON.parse(f.options.body).text);
  const message = (id, text) => ({
    id,
    authorId: editor.uuid,
    authorName: editor.username,
    text,
    createdAt: 1,
  });
  // A pasted pile of threads that all mention Alice.
  await commit(boards, editor, room, (b) => {
    b.comments = Array.from({ length: 300 }, (_, n) => ({
      id: "t" + n,
      x: 0,
      y: 0,
      resolved: false,
      messages: [message("m" + n, `Look @alice ${n}`)],
    }));
  });
  await org.flush();
  const notes = await adminCall(org, boards, owner, {
    op: "notifications.list",
  });
  assert.deepEqual(
    notes.items.filter((n) => n.type === "mention").map((n) => n.text),
    ["Bob: Look @alice 0"],
  );
  assert.equal(posts().length, 1);
  // Two people mentioned in one comment still means one channel post, and
  // Slack codes in the text show as written instead of pinging everyone.
  await commit(boards, editor, room, (b) => {
    b.comments[0].messages.push(
      message("x1", "@alice and @cam <!channel> see <https://x.ca|here> & go"),
    );
  });
  await org.flush();
  assert.equal(posts().length, 2);
  assert.equal(
    posts()[1],
    "Bob: @alice and @cam &lt;!channel&gt; see &lt;https://x.ca|here&gt; &amp; go",
  );
  // The first messages of an edit are audited one by one and the rest in
  // one record that counts them, so every message is still accounted for.
  const audits = (await org.list("org:audit:"))
    .map((r) => r.value)
    .filter((r) => r.action === "board.comment.created");
  assert.equal(audits.length, 22);
  assert.equal(
    audits.reduce((sum, r) => sum + (r.details.count ?? 1), 0),
    301,
  );
  const folded = audits.find((r) => r.details.count);
  assert.equal(folded.details.count, 280);
  assert.equal(folded.details.threads.length, 20);
  assert.equal(folded.details.mentions, 280);
});

test("board content search finds only boards the person can still open", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  await call(owner, { op: "org.policy.set", policy: { guestExpiryDays: 1 } });
  const { token: memberToken } = await call(owner, {
    op: "org.invite",
    role: "member",
  });
  await call(editor, { op: "org.join", token: memberToken });
  await call(viewer, {
    op: "org.join",
    token: (await call(owner, { op: "org.invite", role: "member" })).token,
  });
  const secret = createInput("Merger", [
    item("note", 0, 0, { text: "acquire contoso" }),
  ]);
  await boards.call(owner, secret.input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room: secret.room,
    guest: true,
    role: "viewer",
  });
  await boards.call(guest, { op: "join", room: secret.room, token });
  const reorg = createInput("Reorg", [
    item("note", 0, 0, { text: "team alpha changes" }),
  ]);
  await boards.call(owner, reorg.input);
  await boards.call(owner, {
    op: "settings",
    room: reorg.room,
    visibility: "organization",
  });
  await boards.call(editor, { op: "join", room: reorg.room });
  const search = async (user, query, scope = "organization") =>
    (await call(user, { op: "org.boards", scope, query, content: true }))
      .boards;
  // People with access, including members who have not opened a board
  // shared with the organization, find it by its content.
  assert.equal((await search(guest, "contoso", "mine")).length, 1);
  assert.equal((await search(editor, "alpha")).length, 1);
  assert.equal((await search(viewer, "alpha")).length, 1);
  // A removed member no longer does.
  await boards.call(owner, {
    op: "role",
    room: reorg.room,
    uuid: editor.uuid,
    role: "removed",
  });
  assert.deepEqual(await search(editor, "alpha"), []);
  assert.equal((await search(viewer, "alpha")).length, 1);
  // Neither does a guest whose access expired.
  const start = Date.now();
  boards.now = org.now = () => start + 3 * 86400_000;
  assert.deepEqual(await search(guest, "contoso", "mine"), []);
  assert.equal((await search(owner, "contoso", "all")).length, 1);
});

test("a member's content search reads only the index of boards they can see", async () => {
  const { org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(editor, {
    op: "org.join",
    token: (await call(owner, { op: "org.invite", role: "member" })).token,
  });
  const room = (n) => `b${String(n).padStart(20, "0")}`;
  for (let n = 0; n < 400; n++) {
    const visible = n < 60;
    await org.kv.set("org:board:" + room(n), {
      room: room(n),
      title: `Board ${n}`,
      visibility: visible ? "organization" : "private",
      created: 1,
    });
    await org.kv.set("org:idx:" + room(n), visible ? "roadmap" : "secret");
    if (visible) await org.kv.set("org:visible:" + room(n), 1);
  }
  const patterns = [];
  const list = org.kv.list.bind(org.kv);
  org.kv.list = (options) => (patterns.push(options.pattern), list(options));
  const { boards: found } = await call(editor, {
    op: "org.boards",
    scope: "organization",
    query: "roadmap",
    content: true,
  });
  assert.equal(found.length, 60);
  assert.ok(!patterns.includes("org:idx:"), patterns.join());
  // Boards that are much of the directory still read the index in pages.
  patterns.length = 0;
  await call(owner, {
    op: "org.boards",
    scope: "all",
    query: "roadmap",
    content: true,
  });
  assert.ok(patterns.includes("org:idx:"));
});

test("the SIEM export sends a record written late, and each record once", async () => {
  const { call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { siem: { mode: "https", url: "https://siem.cds-snc.ca/in" } },
  });
  const policy = await org.policy();
  await siem(org, policy);
  fetched.length = 0;
  let now = Date.now();
  org.now = () => now;
  // One request takes its record's time, then writes it after another
  // request's later record was exported.
  const { set } = org.kv;
  let release;
  const held = new Promise((resolve) => (release = resolve));
  org.kv.set = async (key, value, ...rest) => {
    if (value?.action === "policy.slow") await held;
    return set.call(org.kv, key, value, ...rest);
  };
  const slow = org.audit(owner, "policy.slow", { type: "organization" });
  now += 5;
  await org.audit(owner, "policy.fast", { type: "organization" });
  now += 5;
  await siem(org, policy);
  release();
  await slow;
  now += 20_000;
  await siem(org, policy);
  now += 20_000;
  await siem(org, policy);
  const exported = fetched.flatMap((f) =>
    JSON.parse(f.options.body).events.map((e) => e.Action ?? e.action),
  );
  assert.deepEqual(exported, ["policy.fast", "policy.slow"]);
});

test("the SIEM export moves past a burst larger than the ids it remembers", async () => {
  const { call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { siem: { mode: "https", url: "https://siem.cds-snc.ca/in" } },
  });
  const policy = await org.policy();
  let now = Date.now();
  org.now = () => now;
  await siem(org, policy);
  now += 1000;
  for (let n = 0; n < 2500; n++)
    await org.audit(owner, "policy.burst", { type: "organization" });
  now += 1000;
  await org.audit(owner, "policy.after", { type: "organization" });
  fetched.length = 0;
  for (let round = 0; round < 8; round++) {
    now += 11_000;
    await siem(org, policy);
  }
  const exported = fetched.flatMap((f) =>
    JSON.parse(f.options.body).events.map((e) => e.EventId),
  );
  assert.equal(new Set(exported).size, exported.length);
  assert.equal(exported.length, 2501);
  const last = fetched.at(-1);
  assert.equal(
    JSON.parse(last.options.body).events.at(-1).Action,
    "policy.after",
  );
});

test("an address provisioned inactive deactivates an administrator only by the owner's key", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  for (const user of [editor, viewer]) {
    const { token } = await call(owner, { op: "org.invite", role: "admin" });
    await call(user, { op: "org.join", token });
  }
  const keyOf = async (by) =>
    (await call(by, { op: "apikeys.create", name: "IdP", scopes: ["scim"] }))
      .key;
  const provision = (key, email) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/Users", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      }),
      "POST",
      "Users",
      { userName: email, active: false },
    );
  const verify = async (user, email) => {
    await call(user, { op: "email.start", email });
    const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
    return (await call(user, { op: "email.confirm", code })).user;
  };
  // Another administrator's key cannot deactivate Bob this way.
  await provision(await keyOf(viewer), "bob@cds-snc.ca");
  const bob = await verify(editor, "bob@cds-snc.ca");
  assert.equal(bob.role, "admin");
  assert.equal(bob.status, "active");
  // The owner's key can, as it can deactivate an administrator directly.
  await provision(await keyOf(owner), "cam@cds-snc.ca");
  const cam = await verify(viewer, "cam@cds-snc.ca");
  assert.equal(cam.status, "deactivated");
  assert.equal(cam.inactiveByOwner, undefined);
});

test("a SCIM patch with an operation that is not an object is refused as invalid", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "IdP",
    scopes: ["scim"],
  });
  const scim = (path, method, body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path,
      body,
    );
  const user = await (
    await scim("Users", "POST", { userName: "pat@example.ca" })
  ).json();
  const group = await (
    await scim("Groups", "POST", { displayName: "Design" })
  ).json();
  for (const path of ["Users/" + user.id, "Groups/" + group.id])
    for (const op of [null, 7, "replace"])
      await assert.rejects(
        scim(path, "PATCH", {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [op],
        }),
        (e) => e.status === 400 && e.scimType === "invalidSyntax",
      );
});

test("a SCIM role given on its own rather than in a list is read as one", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { key } = await call(owner, {
    op: "apikeys.create",
    name: "IdP",
    scopes: ["scim"],
  });
  const scim = async (path, method, body) =>
    (
      await restRoute(
        org,
        boards,
        new Request("https://w.puter.work/scim/v2/" + path, {
          method,
          headers: { Authorization: `Bearer ${key}` },
        }),
        method,
        path,
        body,
      )
    ).json();
  const roleOf = (user) => user.roles[0].value;
  const a = await scim("Users", "POST", {
    userName: "a@example.ca",
    roles: "guest",
  });
  assert.equal(roleOf(a), "guest");
  const b = await scim("Users", "POST", {
    userName: "b@example.ca",
    roles: { value: "guest" },
  });
  assert.equal(roleOf(b), "guest");
  const c = await scim("Users", "POST", {
    userName: "c@example.ca",
    roles: [null, 7],
  });
  assert.equal(roleOf(c), "member");
  const patch = (user, operation) =>
    scim("Users/" + user.id, "PATCH", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", ...operation }],
    });
  assert.equal(
    roleOf(await patch(a, { value: { roles: { value: "member" } } })),
    "member",
  );
  assert.equal(roleOf(await patch(a, { value: { roles: "guest" } })), "guest");
  assert.equal(
    roleOf(await patch(a, { path: "roles", value: { value: "member" } })),
    "member",
  );
  assert.equal(
    roleOf(await patch(a, { path: "roles", value: "guest" })),
    "guest",
  );
});

test("only the owner's key turns a pending administrator on or off", async () => {
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS", domains: ["cds-snc.ca"] });
  const { token } = await call(owner, { op: "org.invite", role: "admin" });
  await call(editor, { op: "org.join", token });
  const keyOf = async (by) =>
    (await call(by, { op: "apikeys.create", name: "IdP", scopes: ["scim"] }))
      .key;
  const [ownerKey, adminKey] = [await keyOf(owner), await keyOf(editor)];
  const scim = (key, path, method, body) =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/scim/v2/" + path, {
        method,
        headers: { Authorization: `Bearer ${key}` },
      }),
      method,
      path,
      body,
    );
  const active = (value) => ({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{ op: "replace", path: "active", value }],
  });
  const pat = await (
    await scim(ownerKey, "Users", "POST", { userName: "pat@cds-snc.ca" })
  ).json();
  await call(owner, { op: "org.users.update", uuid: pat.id, role: "admin" });
  await scim(ownerKey, "Users/" + pat.id, "PATCH", active(false));
  const refused = (key, method, body) =>
    assert.rejects(
      scim(key, "Users/" + pat.id, method, body),
      (e) => e.status === 403,
    );
  await refused(adminKey, "PATCH", active(true));
  await refused(adminKey, "PUT", { active: true });
  // Turning Pat off again, by the owner's key, is refused to the other key.
  await scim(ownerKey, "Users/" + pat.id, "PATCH", active(true));
  await refused(adminKey, "PATCH", active(false));
  await scim(ownerKey, "Users/" + pat.id, "PATCH", active(false));
  // Other changes from the administrator's key still apply.
  const renamed = await (
    await scim(adminKey, "Users/" + pat.id, "PUT", { displayName: "Pat" })
  ).json();
  assert.equal(renamed.active, false);
  // Pat stays inactive once they sign in.
  await call(viewer, { op: "email.start", email: "pat@cds-snc.ca" });
  const code = /code is (\d{6})/.exec(sent.at(-1).text)[1];
  const linked = (await call(viewer, { op: "email.confirm", code })).user;
  assert.equal(linked.status, "deactivated");
});

test("an administrator already on a board with a lesser role governs it", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  for (const user of [editor, viewer]) {
    const { token } = await call(owner, { op: "org.invite", role: "member" });
    await call(user, { op: "org.join", token });
  }
  const { input, room } = createInput("Plan");
  await boards.call(editor, input);
  const invite = await boards.call(editor, {
    op: "invite",
    room,
    role: "viewer",
  });
  await boards.call(viewer, { op: "join", room, token: invite.token });
  assert.equal(
    (await boards.call(viewer, { op: "join", room })).member.role,
    "viewer",
  );
  await call(owner, {
    op: "org.users.update",
    uuid: viewer.uuid,
    role: "admin",
  });
  boards.forget(`wb:${room}:member:${viewer.uuid}`);
  const joined = await boards.call(viewer, { op: "join", room });
  assert.equal(joined.member.role, "owner");
  await boards.call(viewer, { op: "settings.get", room });
  // The board's own owner keeps their membership as it is.
  assert.equal(
    (await boards.call(editor, { op: "join", room })).member.role,
    "owner",
  );
});

test("people refused access are not counted as active", async () => {
  const { env, boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const today = new Date(env.now).toISOString().slice(0, 10);
  const count = () => env.data.get("org:daycount:" + today) || 0;
  const before = count();
  const stranger = {
    uuid: "55555555-5555-4555-8555-555555555555",
    username: "Eve",
  };
  for (const user of [editor, viewer, stranger])
    await assert.rejects(boards.call(user, { op: "sync", room }), {
      status: 403,
    });
  await assert.rejects(call(editor, { op: "org.users.list" }), {
    status: 403,
  });
  assert.equal(count(), before);
  // Someone who opens the board is.
  await boards.call(owner, { op: "sync", room });
  assert.ok(count() >= before);
});

test("transferring a board to someone new to it updates its member count", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  const { input, room } = createInput();
  await boards.call(editor, input);
  assert.equal((await org.kv.get("org:board:" + room)).memberCount, 1);
  await boards.call(editor, { op: "transfer", room, uuid: owner.uuid });
  assert.equal((await org.kv.get("org:board:" + room)).memberCount, 2);
});

test("a transferred board stops posting to its previous owner's Slack", async () => {
  const { boards, org, call, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { slack: { enabled: true } } },
  });
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(editor, { op: "org.join", token });
  const { input, room } = createInput();
  await boards.call(editor, input);
  const hook = "https://hooks.slack.com/services/T/B/bob";
  await boards.call(editor, { op: "settings", room, slack: hook });
  await boards.call(editor, { op: "transfer", room, uuid: owner.uuid });
  const { settings } = await boards.call(owner, { op: "settings.get", room });
  assert.equal(settings.slack, false);
  const audits = (await org.list("org:audit:"))
    .map((r) => r.value)
    .filter((r) => r.action === "board.share.slack");
  // Both can share a millisecond, so their order is not checked.
  assert.deepEqual(audits.map((r) => r.details.connected).sort(), [
    false,
    true,
  ]);
  await commit(boards, owner, room, (b) => {
    b.comments = [
      {
        id: "t",
        x: 0,
        y: 0,
        resolved: false,
        messages: [
          {
            id: "m",
            authorId: owner.uuid,
            authorName: owner.username,
            text: "@bob the plan is final",
            createdAt: 1,
          },
        ],
      },
    ];
  });
  await org.flush();
  assert.equal(fetched.filter((f) => f.url === hook).length, 0);
});

test("keys and invitations stop working when their administrator leaves", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token: adminInvite } = await call(owner, {
    op: "org.invite",
    role: "admin",
  });
  await call(editor, { op: "org.join", token: adminInvite });
  const { key } = await call(editor, {
    op: "apikeys.create",
    name: "Sync",
    scopes: ["users:read"],
  });
  const { token } = await call(editor, { op: "org.invite", role: "member" });
  const users = () =>
    restRoute(
      org,
      boards,
      new Request("https://w.puter.work/v1/users", {
        headers: { Authorization: `Bearer ${key}` },
      }),
      "GET",
      "users",
    );
  assert.equal((await users()).status, 200);
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  org.forgetUser?.(editor.uuid);
  await assert.rejects(users(), { status: 401 });
  await assert.rejects(call(viewer, { op: "org.join", token }), {
    status: 403,
    message: /expired or was revoked/,
  });
  // Reactivated, what they made works again.
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "active",
  });
  org.forgetUser?.(editor.uuid);
  assert.equal((await users()).status, 200);
  await call(viewer, { op: "org.join", token });
  assert.equal(await org.role(viewer), "member");
});

test("webhooks stop receiving events when their administrator leaves", async () => {
  const { boards, org, call, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { webhooks: { enabled: true } } },
  });
  const { token } = await call(owner, { op: "org.invite", role: "admin" });
  await call(editor, { op: "org.join", token });
  await call(editor, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/made-in-settings",
  });
  // One made through the REST API with the administrator's key.
  const { key, record } = await call(editor, {
    op: "apikeys.create",
    name: "Automation",
    scopes: ["webhooks:write", "audit:read"],
  });
  const created = await restRoute(
    org,
    boards,
    new Request("https://w.puter.work/v1/webhooks", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    }),
    "POST",
    "webhooks",
    { url: "https://hooks.example.ca/made-with-key" },
  );
  assert.equal(created.status, 201);
  await call(owner, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/owner",
  });
  const start = Date.now();
  let at = start;
  org.now = boards.now = () => at;
  const received = async () => {
    // The webhook list is kept for a minute, so each round starts past it.
    at += 120_000;
    fetched.length = 0;
    await org.audit(owner, "user.joined", { type: "user", id: owner.uuid });
    await org.flush();
    return fetched
      .filter(
        (f) =>
          f.url.startsWith("https://hooks.example.ca/") &&
          JSON.parse(f.options.body).event === "user.joined",
      )
      .map((f) => f.url)
      .sort();
  };
  await org.flush();
  assert.deepEqual(await received(), [
    "https://hooks.example.ca/made-in-settings",
    "https://hooks.example.ca/made-with-key",
    "https://hooks.example.ca/owner",
  ]);
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  org.forgetUser(editor.uuid);
  assert.deepEqual(await received(), ["https://hooks.example.ca/owner"]);
  // Deliveries waiting to be retried are not sent either.
  const hooks = (await org.list("org:webhook:")).map((r) => r.value);
  for (const hook of hooks)
    await org.kv.set(`org:hookq:${hook.id}:${new Date(at).toISOString()}`, {
      hook: hook.id,
      entry: { id: "queued", action: "user.joined", time: "t" },
      attempts: 1,
      next: at,
    });
  assert.deepEqual(await received(), [
    "https://hooks.example.ca/owner",
    "https://hooks.example.ca/owner",
  ]);
  // Reactivated, what they made works again.
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "active",
  });
  org.forgetUser(editor.uuid);
  assert.equal((await received()).length, 5);
  // One made with a key belongs to the key's administrator, so it keeps
  // working when the key is rotated.
  await call(owner, { op: "apikeys.revoke", id: record.id });
  assert.deepEqual(await received(), [
    "https://hooks.example.ca/made-in-settings",
    "https://hooks.example.ca/made-with-key",
    "https://hooks.example.ca/owner",
  ]);
});

test("one request with many events sends a bounded number of webhooks at once", async () => {
  const { boards, call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { webhooks: { enabled: true } } },
  });
  await call(owner, {
    op: "webhooks.create",
    url: "https://hooks.example.ca/wb",
    events: ["*"],
  });
  const { input, room } = createInput();
  await boards.call(owner, input);
  await org.flush();
  fetched.length = 0;
  for (let n = 0; n < 60; n++)
    await org.audit(owner, "board.content.updated", {
      type: "board",
      id: room,
    });
  await org.flush();
  // Every event is audited, but one request sends only a few webhooks;
  // the rest wait in the queue for later requests.
  const sent = () =>
    fetched.filter((f) => f.url === "https://hooks.example.ca/wb").length;
  assert.ok(sent() < 40, `${sent()}`);
  assert.ok((await org.list("org:hookq:")).length > 20);
  // Later requests with events of their own send what is waiting.
  for (let n = 0; n < 8; n++) {
    await call(owner, { op: "org.invite", role: "member" });
    await org.flush();
  }
  assert.ok(sent() >= 60, `${sent()}`);
});

test("the organization's AI is for its members, not guests", async () => {
  const { call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { token } = await call(owner, { op: "org.invite", role: "guest" });
  await call(guest, { op: "org.join", token });
  await assert.rejects(
    call(guest, { op: "org.ai", task: "summarize", prompt: "x" }),
    { status: 403, message: /organization members/ },
  );
});

test("an invitation that fails to join keeps the organization already in use", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://wb.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const { organizationLink } = await import("../src/organization/client.js");
    const A = setup(),
      B = setup();
    const bOwner = {
      uuid: "99999999-9999-4999-8999-999999999999",
      username: "Zed",
    };
    B.org.puter.auth.getUser = async () => bOwner;
    await A.call(owner, { op: "org.setup", name: "Org A" });
    const { token: joinA } = await A.call(owner, {
      op: "org.invite",
      role: "member",
    });
    await A.call(editor, { op: "org.join", token: joinA });
    await B.call(bOwner, { op: "org.setup", name: "Org B" });
    const { token: expired } = await B.call(bOwner, {
      op: "org.invite",
      role: "member",
      days: 1,
    });
    B.org.now = () => Date.now() + 3 * 86_400_000;
    const servers = { "https://a.puter.work": A, "https://b.puter.work": B };
    const saved = new Map();
    const org = createOrganization({
      puter: () => ({
        auth: { isSignedIn: () => true },
        kv: {
          get: async (k) => saved.get(k),
          set: async (k, v) => saved.set(k, v),
        },
      }),
      call: async (_p, server, input) => servers[server].call(editor, input),
      deploy: async () => {},
    });
    await org.use("https://a.puter.work");
    const home = createOrganizationHome({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        d.close = () => d.remove();
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    home.joinDialog(
      organizationLink("https://b.puter.work", expired, "https://wb.test/"),
    );
    const submit = async () => {
      document
        .querySelector("#org-join")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    };
    await submit();
    await submit();
    assert.equal(org.server, "https://a.puter.work");
    assert.equal(org.info.role, "member");
    assert.deepEqual(saved.get(ORG_KEY), { server: "https://a.puter.work" });
    assert.match(
      document.querySelector("#org-join-status").textContent,
      /expired or was revoked/,
    );
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("organization names with dollar signs show as written before joining", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://wb.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const { organizationLink } = await import("../src/organization/client.js");
    const org = {
      server: "https://a.puter.work",
      info: { name: "Old $' Co" },
      preview: async (server) => ({ server, info: { name: "New $$ $& Co" } }),
    };
    const home = createOrganizationHome({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        d.close = () => d.remove();
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    home.joinDialog(
      organizationLink("https://b.puter.work", "token", "https://wb.test/"),
    );
    document
      .querySelector("#org-join")
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      document.querySelector("#org-join-status").textContent,
      "Join New $$ $& Co at b.puter.work? This replaces Old $' Co as your organization.",
    );
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("signing out forgets the organization on the page, not the account's choice", async () => {
  const saved = new Map();
  const org = createOrganization({
    puter: () => ({
      auth: { isSignedIn: () => true },
      kv: {
        get: async (k) => saved.get(k),
        set: async (k, v) => saved.set(k, v),
      },
    }),
    call: async () => ({ name: "CDS", role: "admin", user: {} }),
    deploy: async () => {},
  });
  const changes = [];
  org.onChange(() => changes.push(org.server));
  await org.use("https://a.puter.work");
  assert.equal(org.isAdmin, true);
  org.reset();
  assert.equal(org.server, null);
  assert.equal(org.info, null);
  assert.equal(org.isAdmin, false);
  assert.deepEqual(changes, ["https://a.puter.work", null]);
  assert.deepEqual(saved.get(ORG_KEY), { server: "https://a.puter.work" });
});

test("guest invitations are not made when boards are for members only", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { restrictToOrganization: true },
  });
  const info = await call(owner, { op: "org.info" });
  assert.equal(info.policy.restrictToOrganization, true);
  const { input, room } = createInput();
  await boards.call(owner, input);
  await assert.rejects(
    boards.call(owner, { op: "invite", room, guest: true, role: "viewer" }),
    { status: 403, message: /only allows its own members/ },
  );
  // Invitations for members still work.
  await boards.call(owner, { op: "invite", room, role: "viewer" });
});

test("a board on legal hold keeps its activity log past audit retention", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { retention: { auditDays: 30 } },
  });
  const held = createInput("Held"),
    other = createInput("Other");
  for (const { input } of [held, other]) await boards.call(owner, input);
  await boards.call(owner, { op: "hold", room: held.room, enabled: true });
  const start = Date.now();
  org.now = () => start + 40 * 86_400_000;
  await purge(org);
  const activity = async (room) =>
    (await call(owner, { op: "org.board.activity", room })).entries.map(
      (e) => e.action,
    );
  assert.ok((await activity(held.room)).includes("board.hold.placed"));
  assert.deepEqual(await activity(other.room), []);
});

test("a board's creation audit keeps only a short source label", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const forged = createInput("Forged"),
    imported = createInput("Imported");
  await boards.call(owner, {
    ...forged.input,
    source: { via: "x".repeat(5000), approvedBy: "security" },
  });
  await boards.call(owner, { ...imported.input, source: "miro" });
  const created = (await call(owner, { op: "org.audit" })).entries.filter(
    (e) => e.action === "board.created",
  );
  const source = (room) =>
    created.find((e) => e.target.id === room).details.source;
  assert.equal(source(forged.room), null);
  assert.equal(source(imported.room), "miro");
});

test("a board's kept activity follows audit retention once its hold ends", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { retention: { auditDays: 30 } },
  });
  const { input, room } = createInput("Held");
  await boards.call(owner, input);
  await boards.call(owner, { op: "hold", room, enabled: true });
  const start = Date.now();
  org.now = () => start + 40 * 86_400_000;
  await purge(org);
  await boards.call(owner, { op: "hold", room, enabled: false });
  org.now = () => start + 60 * 86_400_000;
  await purge(org);
  const { entries } = await call(owner, { op: "org.board.activity", room });
  // Only the release, made within the retention period, is left.
  assert.deepEqual(
    entries.map((e) => e.action),
    ["board.hold.released"],
  );
});

test("an administrator removed from a board still opens it", async () => {
  const { boards, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput("Governed");
  await boards.call(owner, input);
  const invitation = await boards.call(owner, {
    op: "invite",
    room,
    role: "viewer",
  });
  await boards.call(editor, { op: "join", room, token: invitation.token });
  await boards.call(owner, {
    op: "role",
    room,
    uuid: editor.uuid,
    role: "removed",
  });
  // Removed, then made an administrator, as the Miro migration leaves the
  // administrator who ran it.
  const { token } = await call(owner, { op: "org.invite", role: "admin" });
  await call(editor, { op: "org.join", token });
  const joined = await boards.call(editor, { op: "join", room });
  assert.equal(joined.member.role, "owner");
  // Removal still keeps other members out.
  await boards.call(viewer, { op: "join", room, token: invitation.token });
  await boards.call(owner, {
    op: "role",
    room,
    uuid: viewer.uuid,
    role: "removed",
  });
  await assert.rejects(
    boards.call(viewer, { op: "join", room, token: invitation.token }),
    { status: 403 },
  );
});

test("a directory update running alongside a visibility change never republishes the board", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput("Secret plans");
  await boards.call(owner, input);
  await boards.call(owner, {
    op: "settings",
    room,
    visibility: "organization",
  });
  assert.equal(await org.kv.get("org:visible:" + room), 1);
  // A commit's activity update reads the directory record, and the board is
  // made private before it writes.
  const get = org.kv.get.bind(org.kv);
  let paused = false;
  org.kv.get = async (key) => {
    const value = await get(key);
    if (
      !paused &&
      key === "org:board:" + room &&
      new Error().stack.includes("recordActivity")
    ) {
      paused = true;
      await boards.call(owner, { op: "settings", room, visibility: "private" });
    }
    return value;
  };
  try {
    await commit(boards, owner, room, (b) =>
      b.items.push(item("note", 10, 10, { text: "More" })),
    );
  } finally {
    org.kv.get = get;
  }
  assert.ok(paused, "The update ran alongside the change");
  assert.equal((await org.kv.get("org:board:" + room)).visibility, "private");
  assert.equal(await org.kv.get("org:visible:" + room), null);
});

test("people whose board access lapsed get no notifications carrying its content", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, { op: "org.policy.set", policy: { guestExpiryDays: 1 } });
  const { token: memberToken } = await call(owner, {
    op: "org.invite",
    role: "member",
  });
  await call(editor, { op: "org.join", token: memberToken });
  const { input, room } = createInput("Secret merger");
  await boards.call(owner, input);
  for (const [user, guestInvite] of [
    [guest, true],
    [editor, false],
  ]) {
    const { token } = await boards.call(owner, {
      op: "invite",
      room,
      role: "editor",
      guest: guestInvite,
    });
    await boards.call(user, { op: "join", room, token });
  }
  const start = Date.now();
  boards.now = org.now = () => start + 2 * 86_400_000;
  await assert.rejects(boards.call(guest, { op: "sync", room }), {
    status: 403,
  });
  await commit(boards, owner, room, (b) => {
    b.comments = [
      {
        id: "t1",
        x: 0,
        y: 0,
        resolved: false,
        messages: [
          {
            id: "m1",
            authorId: owner.uuid,
            authorName: owner.username,
            text: "@dee @bob confidential: acquire contoso",
            createdAt: 1,
          },
        ],
      },
    ];
    for (const person of [guest, editor])
      b.items.push(
        item("note", 0, 0, {
          text: `Task for ${person.username}`,
          task: {
            assignee: { id: person.uuid, name: person.username },
            start: null,
            due: null,
            status: "todo",
          },
        }),
      );
  });
  const list = async (user) =>
    (await call(user, { op: "notifications.list" })).items.map((n) => n.type);
  assert.deepEqual(await list(guest), []);
  assert.deepEqual((await list(editor)).sort(), ["assignment", "mention"]);
});

test("saving a comment sends its notification mail at once, not one after another", async () => {
  const { boards, call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput("Plan");
  await boards.call(owner, input);
  const people = [
    editor,
    viewer,
    { uuid: "55555555-5555-4555-8555-555555555555", username: "Eve" },
  ];
  for (const user of people) {
    const { token } = await boards.call(owner, {
      op: "invite",
      room,
      role: "editor",
    });
    await boards.call(user, { op: "join", room, token });
    await org.kv.set("org:user:" + user.uuid, {
      uuid: user.uuid,
      username: user.username,
      email: `${user.username.toLowerCase()}@cds-snc.ca`,
      emailVerified: true,
      status: "active",
      role: "member",
    });
    org.forgetUser(user.uuid);
  }
  const sent = [];
  org.puter.email = {
    sendTransactional: (message) =>
      new Promise((resolve) =>
        setTimeout(() => {
          sent.push(message.to[0]);
          resolve({ failed: [] });
        }, 400),
      ),
  };
  const started = Date.now();
  await commit(boards, owner, room, (b) => {
    b.comments = [
      {
        id: "t1",
        x: 0,
        y: 0,
        resolved: false,
        messages: [
          {
            id: "m1",
            authorId: owner.uuid,
            authorName: owner.username,
            text: "@bob @cam @eve please review",
            createdAt: 1,
          },
        ],
      },
    ];
  });
  assert.equal(sent.length, 3);
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
});

test("an assignment email names an untitled task in French too", async () => {
  const { newTask } = await import("../src/planning/task.js");
  const { boards, call, org, sent } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const { input, room } = createInput("Sprint", [
    item("note", 0, 0, { text: "" }),
  ]);
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await boards.call(editor, { op: "join", room, token });
  await org.kv.set("org:user:" + editor.uuid, {
    uuid: editor.uuid,
    username: editor.username,
    email: "bob@cds-snc.ca",
    emailVerified: true,
    status: "active",
    role: "member",
  });
  org.forgetUser(editor.uuid);
  await commit(boards, owner, room, (b) => {
    b.items[0].task = {
      ...newTask(),
      assignee: { id: editor.uuid, name: "Bob" },
    };
  });
  await org.flush();
  const mail = JSON.stringify(sent.at(-1));
  assert.match(mail, /Untitled task/);
  assert.match(mail, /Tâche sans titre/);
});

test("a board's Slack channel stops hearing about it once whoever connected it no longer manages it", async () => {
  const { boards, call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { slack: { enabled: true } } },
  });
  const { token: adminToken } = await call(owner, {
    op: "org.invite",
    role: "admin",
  });
  await call(editor, { op: "org.join", token: adminToken });
  const { input, room } = createInput("Budget");
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await boards.call(viewer, { op: "join", room, token });
  // An administrator connects their own channel to someone else's board.
  const hook = "https://hooks.slack.com/services/T/B/admins-own";
  await boards.call(editor, { op: "settings", room, slack: hook });
  const mention = (id, text) =>
    commit(boards, viewer, room, (b) => {
      b.comments = [
        ...(b.comments || []),
        {
          id,
          x: 0,
          y: 0,
          resolved: false,
          messages: [
            {
              id: "m-" + id,
              authorId: viewer.uuid,
              authorName: viewer.username,
              text,
              createdAt: Date.now(),
            },
          ],
        },
      ];
    });
  const posts = () => fetched.filter((f) => f.url === hook).length;
  await mention("t1", "@alice first");
  await org.flush();
  assert.equal(posts(), 1);
  // They stop being an administrator.
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    role: "member",
  });
  await mention("t2", "@alice the salary numbers");
  await org.flush();
  assert.equal(posts(), 1);
  assert.equal(await org.kv.get("org:boardslack:" + room), null);
});

test("a board's Slack channel hears about a mention even when the first person mentioned is deactivated", async () => {
  const { boards, call, org, fetched } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, {
    op: "org.policy.set",
    policy: { integrations: { slack: { enabled: true } } },
  });
  const { input, room } = createInput("Plan");
  await boards.call(owner, input);
  for (const user of [editor, viewer]) {
    const { token } = await boards.call(owner, {
      op: "invite",
      room,
      role: "editor",
    });
    await boards.call(user, { op: "join", room, token });
  }
  await org.kv.set(
    "org:boardslack:" + room,
    "https://hooks.slack.com/services/X",
  );
  await org.kv.set("org:user:" + editor.uuid, {
    uuid: editor.uuid,
    username: editor.username,
    status: "deactivated",
    role: "member",
  });
  org.forgetUser(editor.uuid);
  await commit(boards, owner, room, (b) => {
    b.comments = [
      {
        id: "t1",
        x: 0,
        y: 0,
        resolved: false,
        messages: [
          {
            id: "m1",
            authorId: owner.uuid,
            authorName: owner.username,
            text: "@bob @cam please review",
            createdAt: 1,
          },
        ],
      },
    ];
  });
  assert.equal(
    fetched.filter((f) => f.url.includes("hooks.slack.com")).length,
    1,
  );
});

test("the directory lists only boards a guest can still open, never the trash to members, and keeps managers' details to administrators", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, { op: "org.policy.set", policy: { guestExpiryDays: 1 } });
  for (const user of [editor, viewer])
    await call(user, {
      op: "org.join",
      token: (await call(owner, { op: "org.invite", role: "member" })).token,
    });
  const kickoff = createInput("Kickoff");
  await boards.call(owner, kickoff.input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room: kickoff.room,
    guest: true,
    role: "viewer",
  });
  await boards.call(guest, { op: "join", room: kickoff.room, token });
  const titles = async (user, input = {}) =>
    (
      await call(user, { op: "org.boards", scope: "mine", ...input })
    ).boards.map((b) => b.title);
  assert.deepEqual(await titles(guest), ["Kickoff"]);
  // Once the guest's access expires, the board, renamed since, is not listed.
  const start = Date.now();
  boards.now = org.now = () => start + 3 * 86400_000;
  await commit(boards, owner, kickoff.room, (x) => {
    x.title = "Layoffs Q4";
  });
  assert.deepEqual(await titles(guest), []);
  assert.deepEqual(await titles(guest, { query: "layoffs" }), []);
  boards.now = org.now = () => Date.now();
  // Details for managers stay with administrators.
  const held = createInput("Board");
  await boards.call(owner, held.input);
  await boards.call(owner, {
    op: "settings",
    room: held.room,
    visibility: "organization",
    orgRole: "commenter",
  });
  await boards.call(owner, { op: "hold", room: held.room, enabled: true });
  await boards.call(viewer, { op: "join", room: held.room });
  const row = (
    await call(viewer, { op: "org.boards", scope: "organization" })
  ).boards.find((b) => b.room === held.room);
  assert.equal(row.title, "Board");
  for (const key of ["legalHold", "lastEditor", "fingerprint"])
    assert.equal(row[key], undefined, key);
  const all = (await call(owner, { op: "org.boards", scope: "all" })).boards;
  assert.equal(all.find((b) => b.room === held.room).legalHold, true);
  // A member's boards in the trash are not listed to them.
  const gone = createInput("Gone");
  await boards.call(owner, gone.input);
  const invite = await boards.call(owner, {
    op: "invite",
    room: gone.room,
    role: "editor",
  });
  await boards.call(editor, {
    op: "join",
    room: gone.room,
    token: invite.token,
  });
  await boards.call(owner, { op: "delete", room: gone.room });
  assert.deepEqual(await titles(editor, { deleted: true }), []);
});

test("content removed within a minute of the last index write leaves the search index once someone synchronizes or leaves", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(editor, {
    op: "org.join",
    token: (await call(owner, { op: "org.invite", role: "member" })).token,
  });
  const search = async () =>
    (
      await call(editor, {
        op: "org.boards",
        scope: "organization",
        query: "salary",
        content: true,
      })
    ).boards.length;
  for (const via of ["sync", "leave"]) {
    const b = createInput("Budget", [item("note", 0, 0, { text: "hello" })]);
    await boards.call(owner, b.input);
    await boards.call(owner, {
      op: "settings",
      room: b.room,
      visibility: "organization",
    });
    let now = Date.now();
    boards.now = org.now = () => now;
    await commit(boards, owner, b.room, (x) =>
      x.items.push(item("note", 5, 5, { text: "salary cuts for Bob" })),
    );
    now += 10_000;
    await commit(boards, owner, b.room, (x) => {
      x.items = x.items.filter((i) => !String(i.text).includes("salary"));
    });
    assert.equal(await search(), 1, `${via}: not yet written`);
    if (via === "sync") {
      now += 61_000;
      await boards.call(owner, { op: "sync", room: b.room });
    } else
      await boards.call(owner, {
        op: "leave",
        room: b.room,
        session: crypto.randomUUID(),
      });
    assert.equal(await search(), 0, via);
    boards.now = org.now = () => Date.now();
  }
});

test("content search leaves out what the workshop hides until it is revealed", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(editor, {
    op: "org.join",
    token: (await call(owner, { op: "org.invite", role: "member" })).token,
  });
  const frame = item("frame", 0, 0, { text: "Answers", w: 400, h: 400 });
  const b = createInput("Quiz", [
    frame,
    item("note", 10, 10, { text: "answer is paris", parentId: frame.id }),
  ]);
  await boards.call(owner, b.input);
  await boards.call(owner, {
    op: "settings",
    room: b.room,
    visibility: "organization",
    orgRole: "editor",
  });
  const settings = (hide) => (x) => {
    x.workshop = {
      ...(x.workshop || {}),
      settings: { lock: "open", private: null, anonymous: false, hide },
    };
  };
  let now = Date.now();
  boards.now = org.now = () => now;
  await commit(boards, owner, b.room, settings([frame.id]));
  await boards.call(editor, { op: "join", room: b.room });
  const search = async () =>
    (
      await call(editor, {
        op: "org.boards",
        scope: "mine",
        query: "paris",
        content: true,
      })
    ).boards.length;
  assert.equal(await search(), 0);
  now += 5_000;
  await commit(boards, owner, b.room, settings([]));
  now += 61_000;
  await boards.call(owner, { op: "sync", room: b.room });
  assert.equal(await search(), 1, "revealed content is found");
  boards.now = org.now = () => Date.now();
});

test("live event handles end with the access they were given for", async () => {
  const { destroyBoard } = await import("../worker/retention.js");
  const { boards, org, call, fetched } = setup();
  const revoked = () =>
    fetched
      .filter((f) => f.options.method === "DELETE")
      .map((f) => f.url.split("/").at(-1));
  await call(owner, { op: "org.setup", name: "CDS" });
  await call(owner, { op: "org.policy.set", policy: { guestExpiryDays: 1 } });
  await call(editor, {
    op: "org.join",
    token: (await call(owner, { op: "org.invite", role: "admin" })).token,
  });
  // An administrator watching a board they never joined, then deactivated.
  const watched = createInput("Private HR");
  await boards.call(owner, watched.input);
  await boards.call(editor, { op: "events", room: watched.room });
  assert.ok(await org.kv.get(`wb:${watched.room}:handle:${editor.uuid}`));
  await call(owner, {
    op: "org.users.update",
    uuid: editor.uuid,
    status: "deactivated",
  });
  assert.equal(revoked().length, 1);
  assert.equal(
    await org.kv.get(`wb:${watched.room}:handle:${editor.uuid}`),
    null,
  );
  // A refused operation by someone who keeps access leaves it.
  const team = createInput("Team");
  await boards.call(owner, team.input);
  const member = await boards.call(owner, {
    op: "invite",
    room: team.room,
    role: "editor",
  });
  await boards.call(viewer, {
    op: "join",
    room: team.room,
    token: member.token,
  });
  await boards.call(viewer, { op: "events", room: team.room });
  await assert.rejects(
    boards.call(viewer, { op: "settings.get", room: team.room }),
    {
      status: 403,
    },
  );
  assert.equal(revoked().length, 1, "an ordinary refusal");
  assert.ok(await org.kv.get(`wb:${team.room}:handle:${viewer.uuid}`));
  // A guest whose access lapsed, once refused.
  const kickoff = createInput("Kickoff");
  await boards.call(owner, kickoff.input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room: kickoff.room,
    guest: true,
    role: "viewer",
  });
  await boards.call(guest, { op: "join", room: kickoff.room, token });
  await boards.call(guest, { op: "events", room: kickoff.room });
  const start = Date.now();
  boards.now = org.now = () => start + 3 * 86400_000;
  await assert.rejects(boards.call(guest, { op: "sync", room: kickoff.room }), {
    status: 403,
  });
  assert.equal(revoked().length, 2);
  assert.equal(
    await org.kv.get(`wb:${kickoff.room}:handle:${guest.uuid}`),
    null,
  );
  boards.now = org.now = () => Date.now();
  // A purged board's handles are revoked, not only forgotten.
  const temp = createInput("Temp");
  await boards.call(owner, temp.input);
  const invite = await boards.call(owner, {
    op: "invite",
    room: temp.room,
    role: "editor",
  });
  await boards.call(viewer, {
    op: "join",
    room: temp.room,
    token: invite.token,
  });
  await boards.call(viewer, { op: "events", room: temp.room });
  await boards.call(owner, { op: "delete", room: temp.room });
  await destroyBoard(org, temp.room);
  assert.equal(revoked().length, 3);
  assert.equal(await org.kv.get(`org:uh:${viewer.uuid}:${temp.room}`), null);
});

test("boards whose text is all hidden keep content fingerprints of their own", async () => {
  const { boards, org, call } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const rooms = [];
  for (const text of ["answer is paris", "answer is rome"]) {
    const frame = item("frame", 0, 0, { text: "Answers", w: 400, h: 400 });
    const b = createInput("Quiz", [
      frame,
      item("note", 10, 10, { text, parentId: frame.id }),
    ]);
    await boards.call(owner, b.input);
    let now = Date.now();
    boards.now = org.now = () => (now += 61_000);
    await commit(boards, owner, b.room, (x) => {
      x.workshop = {
        settings: {
          lock: "open",
          private: null,
          anonymous: false,
          hide: [frame.id],
        },
      };
      x.items[1].text += ".";
    });
    rooms.push(b.room);
  }
  boards.now = org.now = () => Date.now();
  const records = await Promise.all(
    rooms.map((room) => org.kv.get("org:board:" + room)),
  );
  assert.ok(records.every((r) => r.fingerprint && !("content" in r)));
  assert.notEqual(records[0].fingerprint, records[1].fingerprint);
  assert.equal(await org.kv.get("org:idx:" + rooms[0]), "");
});

test("feedback stores validated language snapshots with trimmed text and keeps anonymous reports", async () => {
  const env = environment(),
    org = env.service.org;
  const call = (input) => adminCall(org, env.service, owner, input);
  await call({ op: "org.setup", name: "Feedback metadata audit" });
  const text = "Start. Veuillez faciliter la navigation. End.";
  const frenchStart = text.indexOf("Veuillez"),
    frenchEnd = text.indexOf(" End.");
  await call({
    op: "feedback.submit",
    ease: 4,
    comment: "  " + text + "  ",
    lang: "en-ca",
    textRuns: [
      { start: frenchStart + 2, end: frenchEnd + 2, style: { lang: "fr-ca" } },
    ],
    context: "help",
  });
  const saved = [...env.data]
    .filter(([key]) => key.startsWith("org:feedback:"))
    .map(([, value]) => value)[0];
  assert.equal(saved.comment, text);
  assert.equal(saved.lang, "en-CA");
  assert.deepEqual(saved.textRuns, [
    { start: frenchStart, end: frenchEnd, style: { lang: "fr-CA" } },
  ]);
  const report = await call({ op: "org.reports", days: 30 });
  assert.equal(report.feedback.recent[0].lang, "en-CA");
  assert.deepEqual(report.feedback.recent[0].textRuns, saved.textRuns);
  assert.equal(report.feedback.recent[0].uuid, undefined);
  assert.equal(saved.uuid, undefined);
  for (const metadata of [
    { lang: "bad tag" },
    { textRuns: [{ start: 0, end: 999, style: { lang: "fr" } }] },
    { textRuns: [{ start: 0, end: 3, style: { bold: true } }] },
    { textRuns: [{ start: 0, end: 3, style: { lang: "bad tag" } }] },
  ])
    await assert.rejects(
      call({ op: "feedback.submit", ease: 3, comment: "Hello", ...metadata }),
      { status: 400 },
    );
  await call({ op: "feedback.submit", ease: 5, comment: "Legacy" });
  const legacy = [...env.data].filter(
    ([key, value]) =>
      key.startsWith("org:feedback:") && value.comment === "Legacy",
  )[0][1];
  assert.equal(legacy.lang, undefined);
  assert.equal(legacy.textRuns, undefined);
});

test("feedback language ranges are clipped safely at the comment limit and blank ratings discard tags", async () => {
  const { call, org } = setup();
  await call(owner, { op: "org.setup", name: "CDS" });
  const comment = "a".repeat(999) + "😀 suite";
  await call(owner, {
    op: "feedback.submit",
    ease: 3,
    comment,
    lang: "en",
    textRuns: [{ start: 995, end: comment.length, style: { lang: "fr" } }],
  });
  const record = (await org.list("org:feedback:")).map((r) => r.value)[0];
  assert.equal(record.comment, "a".repeat(999));
  assert.deepEqual(record.textRuns, [
    { start: 995, end: 999, style: { lang: "fr" } },
  ]);
  await assert.rejects(
    call(owner, {
      op: "feedback.submit",
      ease: 3,
      comment: "😀",
      textRuns: [{ start: 1, end: 2, style: { lang: "fr" } }],
    }),
    { status: 400 },
  );
  await call(owner, {
    op: "feedback.submit",
    ease: 5,
    comment: "   ",
    lang: "fr",
    textRuns: [{ start: 0, end: 3, style: { lang: "fr" } }],
  });
  const blank = (await org.list("org:feedback:"))
    .map((r) => r.value)
    .find((r) => !r.comment);
  assert.equal(blank.lang, undefined);
  assert.equal(blank.textRuns, undefined);
  const report = await call(owner, { op: "org.reports", days: 30 });
  assert.equal(report.feedback.responses, 2);
  assert.equal(report.feedback.recent.length, 1);
  assert.deepEqual(report.feedback.recent[0].textRuns, record.textRuns);
});
