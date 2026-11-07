import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { normalizePolicy } from "../worker/org.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function withConsole(request, verify, role = "owner") {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
    pretendToBeVisual: true,
  });
  const keys = [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "location",
  ];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { createAdminConsole } =
    await import("../src/organization/admin-ui.js");
  const toasts = [];
  const responses = {
    "org.policy.get": {
      policy: normalizePolicy(),
      secrets: {},
      owner: { uuid: "owner" },
    },
    "apikeys.list": { keys: [], scopes: ["audit:read"] },
    "webhooks.list": { webhooks: [], events: ["*"], pending: 0 },
    "org.audit": { entries: [], cursor: null },
    "org.users.list": {
      users: [],
      owner: { uuid: "owner", username: "Alice" },
    },
    "teams.list": { teams: [] },
  };
  const admin = createAdminConsole({
    org: {
      isAdmin: true,
      info: { role },
      server: "https://whiteboard-abc.puter.work",
      request: (op, data) =>
        Promise.resolve(request(op, data) ?? responses[op]),
    },
    modal(title, html, ready) {
      const d = document.createElement("dialog");
      d.innerHTML = html;
      d.setAttribute("open", "");
      d.close = () => {
        d.removeAttribute("open");
        d.dispatchEvent(new dom.window.Event("close"));
        d.remove();
      };
      document.body.append(d);
      ready?.(d);
      return d;
    },
    icon: () => "",
    toast: (message) => toasts.push(message),
    download() {},
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  try {
    await verify({ admin, toasts, settle, window: dom.window });
  } finally {
    dom.window.close();
    for (const key of keys) delete globalThis[key];
  }
}

for (const [formId, operation, response, field] of [
  ["key-form", "apikeys.create", { key: "wbk_new-key" }, "k"],
  ["hook-form", "webhooks.create", { secret: "whsec_new-secret" }, "h"],
]) {
  test(`${operation} completing after navigation keeps the selected tab and reveals the secret when returning`, async () => {
    const action = deferred();
    await withConsole(
      (op) => (op === operation ? action.promise : undefined),
      async ({ admin, settle, window }) => {
        const d = admin.open("security");
        await settle();
        d.querySelector(`#${formId}`).dispatchEvent(
          new window.Event("submit", { cancelable: true }),
        );
        d.querySelector('[data-tab="audit"]').click();
        await settle();
        const before = d.querySelector("#admin-panel").innerHTML;
        action.resolve(response);
        await settle();
        assert.equal(
          d.querySelector('[aria-selected="true"]').dataset.tab,
          "audit",
        );
        assert.equal(d.querySelector("#admin-panel").innerHTML, before);
        d.querySelector('[data-tab="security"]').click();
        await settle();
        assert.equal(d.querySelector(`#${field}-output-field`).hidden, false);
        assert.equal(
          d.querySelector(`#${field}-output`).value,
          response.key || response.secret,
        );
      },
    );
  });
}

test("a rejected action from an earlier tab does not put its error on the current tab", async () => {
  const action = deferred();
  await withConsole(
    (op) => (op === "org.invite.revoke" ? action.promise : undefined),
    async ({ admin, settle }) => {
      const d = admin.open("people");
      await settle();
      const button = d.querySelector("#revoke-org-invites");
      button.click();
      button.click();
      d.querySelector('[data-tab="audit"]').click();
      await settle();
      action.reject(Error("Old invitation failure"));
      await settle();
      assert.equal(d.querySelector("#admin-error").hidden, true);
      assert.equal(d.querySelector("#admin-error").textContent, "");
    },
  );
});

test("revoking invitations after navigation does not access the replacement panel", async () => {
  const action = deferred();
  await withConsole(
    (op) => (op === "org.invite.revoke" ? action.promise : undefined),
    async ({ admin, settle }) => {
      const d = admin.open("people");
      await settle();
      const button = d.querySelector("#revoke-org-invites");
      button.click();
      button.click();
      d.querySelector('[data-tab="audit"]').click();
      await settle();
      action.resolve({ ok: true });
      await settle();
      assert.equal(d.querySelector("#admin-error").textContent, "");
      assert.ok(d.querySelector("#audit-filters"));
    },
  );
});

test("closing settings invalidates a pending panel load", async () => {
  const action = deferred();
  let refreshes = 0;
  await withConsole(
    (op) => {
      if (op === "org.policy.get") {
        refreshes++;
        return action.promise;
      }
    },
    async ({ admin, settle }) => {
      const d = admin.open("policies");
      d.close();
      action.resolve({ policy: normalizePolicy() });
      await settle();
      assert.equal(refreshes, 1);
      assert.equal(d.querySelector("#policy-form"), null);
    },
  );
});

test("a secret created in a closed dialog is never revealed in a replacement dialog", async () => {
  const action = deferred();
  await withConsole(
    (op) => (op === "apikeys.create" ? action.promise : undefined),
    async ({ admin, settle, window, toasts }) => {
      const first = admin.open("security");
      await settle();
      first
        .querySelector("#key-form")
        .dispatchEvent(new window.Event("submit", { cancelable: true }));
      first.close();
      const next = admin.open("security");
      await settle();
      action.resolve({ key: "wbk_previous-session" });
      await settle();
      assert.equal(next.querySelector("#k-output-field").hidden, true);
      assert.equal(next.querySelector("#k-output").value, "");
      assert.deepEqual(toasts, []);
      next.querySelector('[data-tab="audit"]').click();
      await settle();
      next.querySelector('[data-tab="security"]').click();
      await settle();
      assert.equal(next.querySelector("#k-output-field").hidden, true);
    },
  );
});

test("a key and webhook created concurrently both retain their one-time secrets", async () => {
  const key = deferred();
  const hook = deferred();
  await withConsole(
    (op) =>
      op === "apikeys.create"
        ? key.promise
        : op === "webhooks.create"
          ? hook.promise
          : undefined,
    async ({ admin, settle, window }) => {
      const d = admin.open("security");
      await settle();
      for (const id of ["key-form", "hook-form"])
        d.querySelector(`#${id}`).dispatchEvent(
          new window.Event("submit", { cancelable: true }),
        );
      d.querySelector('[data-tab="audit"]').click();
      await settle();
      key.resolve({ key: "wbk_parallel" });
      await settle();
      hook.resolve({ secret: "whsec_parallel" });
      await settle();
      d.querySelector('[data-tab="security"]').click();
      await settle();
      assert.equal(d.querySelector("#k-output-field").hidden, false);
      assert.equal(d.querySelector("#h-output-field").hidden, false);
      assert.equal(d.querySelector("#k-output").value, "wbk_parallel");
      assert.equal(d.querySelector("#h-output").value, "whsec_parallel");
      // The warning that a secret is shown once is visible, not only read
      // out by a screen reader.
      const note = d.querySelector("#h-output-note");
      assert.equal(note.hidden, false);
      assert.match(note.textContent, /will not be shown again/);
      assert.equal(d.querySelector("#k-output-note").hidden, false);
    },
  );
});

test("security reloads retain issued secrets until revoked or the dialog closes", async () => {
  await withConsole(
    (op) => {
      if (op === "apikeys.create")
        return { key: "wbk_saved", record: { id: "key1" } };
      if (op === "apikeys.list")
        return {
          keys: [
            {
              id: "key1",
              name: "Test",
              scopes: ["audit:read"],
              prefix: "wbk_saved",
            },
          ],
          scopes: ["audit:read"],
        };
      if (op === "webhooks.create")
        return { secret: "whsec_saved", webhook: { id: "hook1" } };
      if (op === "apikeys.revoke") return { ok: true };
    },
    async ({ admin, settle, window }) => {
      const d = admin.open("security");
      await settle();
      for (const id of ["key-form", "hook-form"]) {
        d.querySelector(`#${id}`).dispatchEvent(
          new window.Event("submit", { cancelable: true }),
        );
        await settle();
      }
      assert.equal(d.querySelector("#k-output").value, "wbk_saved");
      assert.equal(d.querySelector("#h-output").value, "whsec_saved");
      assert.equal(d.querySelector("#k-output-field").hidden, false);
      const audit = d.querySelector('[data-tab="audit"]');
      audit.focus();
      audit.click();
      await settle();
      const security = d.querySelector('[data-tab="security"]');
      security.focus();
      security.click();
      await settle();
      assert.equal(document.activeElement, security);
      const revoke = d.querySelector('[data-revoke-key="key1"]');
      revoke.click();
      revoke.click();
      await settle();
      assert.equal(d.querySelector("#k-output-field").hidden, true);
      assert.equal(d.querySelector("#h-output-field").hidden, false);
      d.close();
      const next = admin.open("security");
      await settle();
      assert.equal(next.querySelector("#h-output-field").hidden, true);
    },
  );
});

for (const role of ["admin", "owner"]) {
  test(`People controls match ${role} permissions for administering administrators`, async () => {
    await withConsole(
      (op) =>
        op === "org.users.list"
          ? {
              owner: { uuid: "owner", username: "Alice" },
              users: [
                {
                  uuid: "admin1",
                  username: "Bob",
                  role: "admin",
                  status: "active",
                  teams: [],
                },
                {
                  uuid: "member1",
                  username: "Cam",
                  role: "member",
                  status: "active",
                  teams: [],
                },
              ],
            }
          : undefined,
      async ({ admin, settle }) => {
        const d = admin.open("people");
        await settle();
        const limited = role === "admin";
        assert.equal(d.querySelector('[data-role="admin1"]').disabled, limited);
        assert.equal(
          d.querySelector('[data-status="admin1"]').disabled,
          limited,
        );
        assert.equal(
          d.querySelector('[data-role="member1"] option[value="admin"]')
            .disabled,
          limited,
        );
        assert.equal(d.querySelector('[data-role="member1"]').disabled, false);
        assert.equal(
          d.querySelector('[data-status="member1"]').disabled,
          false,
        );
        assert.equal(
          !!d.querySelector('#invite-role option[value="admin"]'),
          !limited,
        );
      },
      role,
    );
  });
}
