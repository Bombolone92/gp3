import test from "node:test";
import assert from "node:assert/strict";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode } from "../src/collaboration/protocol.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner, viewer } from "./collaboration-helpers.js";

const guest = {
  uuid: "44444444-4444-4444-8444-444444444444",
  username: "Dee",
};
function setup() {
  const env = environment();
  const boards = env.service,
    org = boards.org;
  const sent = [];
  org.puter.email = {
    async sendTransactional(message) {
      sent.push(message);
      return { failed: [] };
    },
  };
  org.fetcher = boards.fetcher = async () =>
    new Response("{}", { status: 200 });
  const call = (user, input) => adminCall(org, boards, user, input);
  return { env, boards, org, call, sent };
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
const codeOf = (sent) => /code is (\d{6})/.exec(sent.at(-1).text)[1];
async function capturing(call, domains = ["fabrikam.test"]) {
  await call(owner, { op: "org.setup", name: "Fabrikam", domains });
  await call(owner, { op: "org.policy.set", policy: { domainCapture: true } });
}

test("a verification code is only said to be sent when Puter delivers it", async () => {
  const { call, org } = setup();
  await capturing(call);
  const refused = { status: 502, message: /could not be sent/ };
  // Puter reports the address as failed, or suppressed.
  for (const outcome of ["failed", "suppressed"]) {
    org.puter.email = {
      async sendTransactional(message) {
        return { [outcome]: message.to };
      },
    };
    await assert.rejects(
      call(viewer, { op: "email.start", email: "cam@fabrikam.test" }),
      refused,
    );
  }
  // A runtime with no mail service at all sends nothing either.
  org.puter.email = undefined;
  await assert.rejects(
    call(viewer, { op: "email.start", email: "cam@fabrikam.test" }),
    refused,
  );
  // An older runtime that only has send() still delivers.
  const sent = [];
  org.puter.email = {
    async send(message) {
      sent.push(message);
      return {};
    },
  };
  assert.deepEqual(
    await call(viewer, { op: "email.start", email: "cam@fabrikam.test" }),
    { sent: true },
  );
  assert.deepEqual(sent[0].to, ["cam@fabrikam.test"]);
  const result = await call(viewer, {
    op: "email.confirm",
    code: codeOf(sent),
  });
  assert.equal(result.user.role, "member");
});

test("domain capture counts subdomains as the organization, as migrations do", async () => {
  const { call, sent, boards } = setup();
  await capturing(call);
  await call(viewer, { op: "email.start", email: "cam@eng.fabrikam.test" });
  const result = await call(viewer, {
    op: "email.confirm",
    code: codeOf(sent),
  });
  assert.equal(result.user.role, "member");
  // A look-alike domain is not a subdomain.
  await assert.rejects(
    call(guest, { op: "email.start", email: "dee@notfabrikam.test" }),
    { status: 403 },
  );
  // A migration agrees on who is inside.
  const { input, room } = createInput();
  await boards.call(owner, input);
  await call(owner, {
    op: "migration.apply",
    room,
    members: [
      { email: "zed@eng.fabrikam.test", role: "editor" },
      { email: "out@notfabrikam.test", role: "editor" },
    ],
  });
  const { users } = await call(owner, { op: "org.users.list" });
  const role = (email) => users.find((u) => u.email === email)?.role;
  assert.equal(role("zed@eng.fabrikam.test"), "member");
  assert.equal(role("out@notfabrikam.test"), "guest");
});

test("a board guest captured as a member stops counting as a guest on the board", async () => {
  const { call, sent, boards, org } = setup();
  await capturing(call);
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await boards.call(guest, { op: "join", room, token });
  assert.equal((await org.kv.get("org:board:" + room)).guestCount, 1);
  await call(guest, { op: "email.start", email: "dee@fabrikam.test" });
  const result = await call(guest, { op: "email.confirm", code: codeOf(sent) });
  assert.equal(result.user.role, "member");
  assert.equal((await org.kv.get("org:board:" + room)).guestCount, 0);
  const listed = await call(owner, {
    op: "org.boards",
    scope: "all",
    guests: true,
  });
  assert.ok(!listed.boards.some((b) => b.room === room));
});

test("guests with a verified address join when capture comes to cover it", async () => {
  const { call, sent, boards, org } = setup();
  await call(owner, { op: "org.setup", name: "Fabrikam" });
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await boards.call(guest, { op: "join", room, token });
  await boards.call(viewer, { op: "join", room, token });
  // Both verify work addresses while the organization captures nothing.
  for (const [who, email] of [
    [guest, "dee@fabrikam.test"],
    [viewer, "vic@fabrikam.test"],
  ]) {
    await call(who, { op: "email.start", email });
    const { user } = await call(who, {
      op: "email.confirm",
      code: codeOf(sent),
    });
    assert.equal(user.role, "guest");
  }
  // An administrator made Vic a guest on purpose.
  for (const role of ["member", "guest"])
    await call(owner, {
      op: "org.users.update",
      uuid: viewer.uuid,
      role,
    });
  // Adding the domain with capture on brings Dee in at once.
  await call(owner, {
    op: "org.policy.set",
    policy: { domains: ["fabrikam.test"], domainCapture: true },
  });
  assert.equal((await call(guest, { op: "org.info" })).role, "member");
  assert.equal((await call(viewer, { op: "org.info" })).role, "guest");
  assert.equal((await org.kv.get("org:board:" + room)).guestCount, 1);
  const audit = await call(owner, { op: "org.audit" });
  assert.ok(
    audit.entries.some(
      (e) =>
        e.action === "user.joined" &&
        e.actor.uuid === guest.uuid &&
        e.details?.source === "domain",
    ),
  );
});

test("a verified guest the policy change did not reach joins on arrival", async () => {
  const { call, sent, boards, org } = setup();
  await capturing(call, ["contoso.test"]);
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await boards.call(guest, { op: "join", room, token });
  await call(guest, { op: "email.start", email: "dee@fabrikam.test" }).catch(
    () => {},
  );
  // Verified while the domain was not captured.
  const { user } = await call(guest, {
    op: "email.confirm",
    code: codeOf(sent),
  });
  assert.equal(user.role, "guest");
  // The domain is added by another route that captures no one, as an
  // earlier worker would have stored it.
  const meta = await org.kv.get("org:meta");
  meta.policy.domains.push("fabrikam.test");
  await org.saveMeta(meta);
  assert.equal((await call(guest, { op: "org.info" })).role, "member");
});

test("a verified guest is still offered to verify a work email while capture is on", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { createOrganizationHome } =
    await import("../src/organization/home-ui.js");
  try {
    const org = {
      server: "https://org.puter.work",
      onChange() {},
      request: async () => ({}),
    };
    const home = createOrganizationHome({
      org,
      modal() {},
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    const offered = (info) => {
      org.info = { name: "Fabrikam", ...info };
      document.body.innerHTML = home.sidebar();
      return document.querySelector('[data-org-action="verify"]')?.textContent;
    };
    const verified = { email: "dee@gmail.test", emailVerified: true };
    assert.equal(
      offered({
        role: "guest",
        user: verified,
        policy: { domainCapture: true },
      }),
      "Verify a work email",
    );
    // Without capture a verified address changes nothing, and members are in.
    assert.equal(
      offered({
        role: "guest",
        user: verified,
        policy: { domainCapture: false },
      }),
      undefined,
    );
    assert.equal(
      offered({
        role: "member",
        user: verified,
        policy: { domainCapture: true },
      }),
      undefined,
    );
    assert.equal(
      offered({ role: "guest", user: null, policy: { domainCapture: true } }),
      "Verify your email",
    );
  } finally {
    dom.window.close();
    for (const key of keys) delete globalThis[key];
  }
});

test("wrong codes from people outside the organization are limited across it", async () => {
  const { call, sent } = setup();
  await capturing(call);
  const accounts = Array.from({ length: 6 }, (_, n) => ({
    uuid: `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`,
    username: `Mal${n}`,
  }));
  let wrong = 0,
    limited = 0;
  for (const who of accounts)
    for (let a = 0; a < 5; a++) {
      await call(who, {
        op: "email.start",
        email: `x${who.username}${a}@fabrikam.test`,
      });
      const right = codeOf(sent);
      const guess = right === "000000" ? "111111" : "000000";
      for (let g = 0; g < 5; g++)
        await call(who, { op: "email.confirm", code: guess }).catch((e) => {
          if (e.status === 400) wrong++;
          else if (e.status === 429) limited++;
        });
    }
  // Past the limit, each account that guessed wrong is held back, and a
  // fresh one gets only the one guess before it is too.
  assert.equal(wrong, 102);
  assert.equal(limited, 48);
  // Someone who has not guessed wrong still joins with the right code.
  const newcomer = {
    uuid: "55555555-5555-4555-8555-999999999999",
    username: "Newcomer",
  };
  await call(newcomer, { op: "email.start", email: "new@fabrikam.test" });
  assert.equal(
    (await call(newcomer, { op: "email.confirm", code: codeOf(sent) })).user
      .role,
    "member",
  );
  // Members verifying their own address are not held up.
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(guest, { op: "org.join", token });
  await call(guest, { op: "email.start", email: "dee@fabrikam.test" });
  const { user } = await call(guest, {
    op: "email.confirm",
    code: codeOf(sent),
  });
  assert.equal(user.emailVerified, true);
});

test("verification emails to people outside the organization are limited across it", async () => {
  const { call, org } = setup();
  await capturing(call);
  const hour = Math.floor(org.now() / 3600_000);
  await org.kv.set(`org:verify-outside-sent:${hour}`, 300);
  await assert.rejects(
    call(viewer, { op: "email.start", email: "cam@fabrikam.test" }),
    { status: 429 },
  );
  // A member is not counted with them.
  const { token } = await call(owner, { op: "org.invite", role: "member" });
  await call(guest, { op: "org.join", token });
  assert.deepEqual(
    await call(guest, { op: "email.start", email: "dee@fabrikam.test" }),
    { sent: true },
  );
});

test("a deactivated person cannot come back in through a plus alias", async () => {
  const { call, sent, boards } = setup();
  await capturing(call);
  await call(viewer, { op: "email.start", email: "cam@fabrikam.test" });
  await call(viewer, { op: "email.confirm", code: codeOf(sent) });
  await call(owner, {
    op: "org.users.update",
    uuid: viewer.uuid,
    status: "deactivated",
  });
  // From another Puter account, the alias reaches the same mailbox.
  const again = {
    uuid: "66666666-6666-4666-8666-666666666666",
    username: "Cam2",
  };
  // Asking says nothing; the code, read in that mailbox, is refused.
  assert.deepEqual(
    await call(again, { op: "email.start", email: "cam+again@fabrikam.test" }),
    { sent: true },
  );
  await assert.rejects(
    call(again, { op: "email.confirm", code: codeOf(sent) }),
    { status: 403, message: "Your organization account is deactivated." },
  );
  // A board guest who verified an alias is not captured either.
  const { input, room } = createInput();
  await boards.call(owner, input);
  const { token } = await boards.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await call(owner, {
    op: "org.policy.set",
    policy: { domainCapture: false },
  });
  await boards.call(again, { op: "join", room, token });
  await call(again, { op: "email.start", email: "cam+again@fabrikam.test" });
  await call(again, { op: "email.confirm", code: codeOf(sent) });
  await call(owner, { op: "org.policy.set", policy: { domainCapture: true } });
  assert.equal((await call(again, { op: "org.info" })).role, "guest");
  // Nor through the plain address when the deactivated one was an alias.
  const tagged = {
    uuid: "99999999-9999-4999-8999-999999999999",
    username: "Tad",
  };
  await call(tagged, { op: "email.start", email: "tad+work@fabrikam.test" });
  await call(tagged, { op: "email.confirm", code: codeOf(sent) });
  await call(owner, {
    op: "org.users.update",
    uuid: tagged.uuid,
    status: "deactivated",
  });
  const plain = {
    uuid: "99999999-9999-4999-8999-999999999990",
    username: "Tad2",
  };
  for (const email of ["tad@fabrikam.test", "tad+other@fabrikam.test"]) {
    await call(plain, { op: "email.start", email });
    await assert.rejects(
      call(plain, { op: "email.confirm", code: codeOf(sent) }),
      { status: 403, message: "Your organization account is deactivated." },
      email,
    );
  }
  // Other people's aliases still join.
  await call(guest, { op: "email.start", email: "dee+wb@fabrikam.test" });
  const { user } = await call(guest, {
    op: "email.confirm",
    code: codeOf(sent),
  });
  assert.equal(user.role, "member");
});

test("claimed email domains are checked label by label, in punycode", async () => {
  const { mergePolicy, normalizePolicy, validEmail } =
    await import("../worker/org.js");
  const claim = (domains, current = normalizePolicy()) =>
    mergePolicy(current, { domains }).domains;
  assert.deepEqual(claim(["münchen.de", "@Example.CA ", "example.xn--p1ai"]), [
    "xn--mnchen-3ya.de",
    "example.ca",
    "example.xn--p1ai",
  ]);
  for (const bad of [
    "-bad-.com",
    "bad-.com",
    "a..b.com",
    "localhost",
    "ex.com.",
    `${"x".repeat(64)}.com`,
  ])
    assert.throws(() => claim([bad]), { status: 400 }, bad);
  assert.throws(() => claim(["gmail.com"]), {
    status: 400,
    message: /Public email domains/,
  });
  // Subdomains count, so a suffix anyone registers under would claim
  // every organization below it.
  for (const open of ["co.uk", "com.au", "github.io", "yahoo.fr"])
    assert.throws(() => claim([open]), { status: 400 }, open);
  assert.deepEqual(claim(["acme.co.uk", "esdc-edsc.gc.ca"]), [
    "acme.co.uk",
    "esdc-edsc.gc.ca",
  ]);
  // A public domain already listed does not stop other changes.
  const kept = normalizePolicy({ domains: ["gmail.com"] });
  assert.deepEqual(claim(["gmail.com", "fabrikam.test"], kept), [
    "gmail.com",
    "fabrikam.test",
  ]);
  // Addresses under an internationalized top-level domain can be verified.
  assert.equal(validEmail("ivan@example.xn--p1ai"), true);
});

test("the policy form names an email domain it cannot claim", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const { normalizePolicy } = await import("../worker/org.js");
    let policy = normalizePolicy({
      name: "Fabrikam",
      domains: ["xn--mnchen-3ya.de"],
    });
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
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast() {},
      icon: () => "",
      download() {},
    });
    const settle = () => new Promise((r) => setTimeout(r, 20));
    const d = admin.open("policies");
    await settle();
    const field = d.querySelector("#p-domains");
    // Stored in punycode, shown as people write it.
    assert.equal(field.value, "münchen.de");
    const type = (value) => {
      field.value = value;
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    };
    const error = () => d.querySelector("#admin-error");
    for (const [value, named] of [
      [
        "münchen.de\nfabrikam-.test",
        /^fabrikam-\.test is not a valid email domain/,
      ],
      ["münchen.de\ngmail.com", /^gmail\.com is a public email domain/],
      ["münchen.de\nco.uk", /^Anyone can register a domain under co\.uk/],
    ]) {
      type(value);
      d.querySelector("#policy-form").requestSubmit();
      await settle();
      assert.match(error().textContent, named);
      assert.equal(error().hidden, false);
      assert.equal(field.getAttribute("aria-invalid"), "true");
    }
    type("");
    const capture = d.querySelector("#p-capture");
    capture.checked = true;
    d.querySelector("#policy-form").requestSubmit();
    await settle();
    assert.match(error().textContent, /^Add an email domain/);
    capture.checked = false;
    assert.equal(saved.length, 0);
    type("münchen.de\nbücher.example");
    assert.equal(field.hasAttribute("aria-invalid"), false);
    d.querySelector("#policy-form").requestSubmit();
    await settle();
    assert.deepEqual(saved.at(-1).domains, [
      "xn--mnchen-3ya.de",
      "xn--bcher-kva.example",
    ]);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("verification tells no one whether an address is held until its code proves the mailbox", async () => {
  const { call, sent } = setup();
  await capturing(call);
  await call(viewer, { op: "email.start", email: "cam@fabrikam.test" });
  await call(viewer, { op: "email.confirm", code: codeOf(sent) });
  // Asking about a held address answers as for any other.
  assert.deepEqual(
    await call(guest, { op: "email.start", email: "cam@fabrikam.test" }),
    { sent: true },
  );
  assert.deepEqual(
    await call(guest, { op: "email.start", email: "nobody@fabrikam.test" }),
    { sent: true },
  );
  // Only the code sent to it, which only its mailbox reads, tells.
  await call(guest, { op: "email.start", email: "cam@fabrikam.test" });
  await assert.rejects(
    call(guest, { op: "email.confirm", code: codeOf(sent) }),
    { status: 409, message: /already linked to another account/ },
  );
});

test("the verify dialog keeps a refusal on the field it concerns", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { createOrganizationHome } =
    await import("../src/organization/home-ui.js");
  try {
    let refuse = true,
      dialog;
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { role: "guest", user: null, policy: {} },
        onChange() {},
        request: async (op) => {
          if (refuse)
            throw Object.assign(
              Error(
                op === "email.start"
                  ? "This email address is already linked to another account."
                  : "That code is not correct.",
              ),
              { status: 409 },
            );
          return { sent: true };
        },
      },
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        document.body.append(dialog);
        ready?.(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    home.verifyDialog();
    const settle = () => new Promise((r) => setTimeout(r, 0));
    const email = dialog.querySelector("#verify-email"),
      error = dialog.querySelector("#verify-error");
    email.value = "cam@fabrikam.test";
    dialog.querySelector("#verify-start").requestSubmit();
    await settle();
    assert.equal(error.getAttribute("role"), "alert");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /already linked/);
    assert.equal(email.getAttribute("aria-invalid"), "true");
    assert.equal(email.getAttribute("aria-describedby"), "verify-error");
    // Trying again clears it; success reads in the status.
    refuse = false;
    dialog.querySelector("#verify-start").requestSubmit();
    await settle();
    assert.equal(error.hidden, true);
    assert.equal(error.textContent, "");
    assert.equal(email.hasAttribute("aria-invalid"), false);
    assert.match(dialog.querySelector("#verify-status").textContent, /sent/);
    // A wrong code marks the code field.
    refuse = true;
    const code = dialog.querySelector("#verify-value");
    code.value = "123456";
    dialog.querySelector("#verify-code").requestSubmit();
    await settle();
    assert.match(error.textContent, /not correct/);
    assert.equal(code.getAttribute("aria-invalid"), "true");
    assert.equal(dialog.querySelector("#verify-status").textContent, "");
  } finally {
    dom.window.close();
    for (const key of keys) delete globalThis[key];
  }
});
