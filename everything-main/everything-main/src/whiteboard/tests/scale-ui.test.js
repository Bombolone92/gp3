import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { scaleData } from "../scripts/generate-scale-data.mjs";
import { validateBoard } from "../src/model.js";
import { scaleOrganization } from "../scripts/scale-organization.js";

const sample = scaleData();
// The People tab lists people by name, with numbers compared as numbers.
const byName = (users) => {
  const compare = new Intl.Collator("en-CA", { numeric: true }).compare;
  return [...users].sort((a, b) =>
    compare(a.username || a.email || "", b.username || b.email || ""),
  );
};

test("offline scale organization runs the real worker for members, board filtering, reports, activity, library use and team changes", async () => {
  const org = scaleOrganization(sample);
  assert.equal((await org.request("org.users.list")).users.length, 500);
  const boards = await org.request("org.boards", { scope: "all", limit: 200 });
  assert.equal(boards.boards.length, 200);
  assert.ok(boards.total > 1000);
  const report = await org.request("org.reports");
  assert.equal(report.users.total, 501);
  assert.equal(report.boards.total, 1500);
  assert.equal(report.sessions.largest[0].participants, 500);
  const audit = await org.request("org.audit", { limit: 100 });
  assert.equal(audit.entries.length, 100);
  assert.ok(audit.cursor);
  const next = await org.request("org.audit", {
    cursor: audit.cursor,
    limit: 100,
  });
  assert.equal(next.entries.length, 100);
  assert.ok(
    next.entries.every(
      (e) => !audit.entries.some((first) => first.id === e.id),
    ),
  );
  const activity = await org.request("org.board.activity", {
    room: sample.boards[0].room,
  });
  assert.equal(activity.entries.length, 10);
  assert.equal((await org.request("library.list")).items.length, 500);
  const template = await org.request("library.get", {
    id: sample.library[0].id,
  });
  assert.equal(validateBoard(JSON.parse(template.board)).items.length, 10);
  await org.request("teams.update", {
    id: sample.teams[0].id,
    name: "Changed team",
    members: [sample.users[499].uuid],
  });
  assert.deepEqual(
    (await org.request("teams.list")).teams.find(
      (tm) => tm.id === sample.teams[0].id,
    ).members,
    [sample.users[499].uuid],
  );
  assert.equal(
    sample.teams[0].name,
    "Sample team 1",
    "fixture mutations are isolated",
  );
});
async function withPeople(verify, request = () => {}, role = "owner") {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
    pretendToBeVisual: true,
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { createAdminConsole } =
    await import("../src/organization/admin-ui.js");
  const { setLanguage } = await import("../src/i18n.js");
  const data = structuredClone(sample);
  const calls = [],
    exports = [];
  const admin = createAdminConsole({
    org: {
      isAdmin: true,
      info: { role },
      request: async (op, input) => {
        calls.push({ op, input });
        return (
          (await request(op, input, data)) ??
          {
            "org.users.list": { users: data.users, owner: data.owner },
            "teams.list": { teams: data.teams },
          }[op] ??
          {}
        );
      },
    },
    modal(title, html, ready) {
      const d = document.createElement("dialog");
      d.innerHTML = html;
      document.body.append(d);
      ready?.(d);
      return d;
    },
    icon: () => "",
    toast() {},
    download: (...args) => exports.push(args),
  });
  const settle = () => new Promise((r) => setTimeout(r, 10));
  try {
    setLanguage("en");
    const d = admin.open("people");
    await settle();
    await verify({
      d,
      data,
      calls,
      exports,
      window: dom.window,
      settle,
      setLanguage,
    });
  } finally {
    setLanguage("en");
    dom.window.close();
    for (const key of keys) delete globalThis[key];
  }
}

test("scale fixture contains 500 identities, their teams, boards, activity, and a valid 5000-note workshop", () => {
  assert.equal(sample.users.length, 500);
  assert.equal(new Set(sample.users.map((u) => u.uuid)).size, 500);
  assert.equal(sample.boards.length, 1500);
  assert.equal(sample.activity.length, 5000);
  assert.equal(sample.library.length, 500);
  assert.equal(validateBoard(sample.workshop).items.length, 5000);
  assert.deepEqual(scaleData(), sample);
  const larger = scaleData(1000);
  assert.equal(larger.users.length, 1000);
  assert.equal(validateBoard(larger.workshop).items.length, 5000);
});

test("an empty directory says no one has joined rather than that no one matches a search", async () => {
  await withPeople(
    async ({ d, window }) => {
      const count = () => d.querySelector("#people-count").textContent;
      assert.equal(count(), "No one has joined yet.");
      assert.match(
        d.querySelector("#people-rows").textContent,
        /No one has joined yet\./,
      );
      const search = d.querySelector("#people-search");
      search.value = "nobody";
      search.dispatchEvent(new window.Event("input"));
      assert.equal(count(), "No people match your search.");
      assert.match(
        d.querySelector("#people-rows").textContent,
        /No people match your search\./,
      );
    },
    (op, input, data) =>
      op === "org.users.list" ? { users: [], owner: data.owner } : undefined,
  );
});

test("500-person directory bounds rendered rows and controls while keeping every person reachable", async () => {
  await withPeople(async ({ d, data, calls }) => {
    assert.equal(d.querySelectorAll("#people-rows > tr").length, 50);
    assert.ok(d.querySelectorAll("#people-rows select").length <= 100);
    const seen = [];
    for (let page = 0; page < 10; page++) {
      seen.push(
        ...[...d.querySelectorAll("[data-role]")].map((el) => el.dataset.role),
      );
      if (page < 9) d.querySelector("#people-next").click();
    }
    assert.deepEqual(
      seen,
      byName(data.users).map((u) => u.uuid),
    );
    assert.equal(d.querySelector("#people-next").disabled, true);
    assert.equal(calls.filter((c) => c.op === "org.users.list").length, 1);
  });
});

test("large board directory's Current, Archived and Deleted states agree with the real worker and CSV export", async () => {
  const org = scaleOrganization(sample);
  const archived = sample.boards.filter((b) => b.archived).length;
  const removed = structuredClone(sample.boards[0]);
  removed.room = "sample-deleted-archived";
  removed.deleted = sample.now;
  org.env.data.set("org:board:" + removed.room, removed);
  await withPeople(
    async ({ d, settle, window, exports }) => {
      const ready = async () => {
        for (let n = 0; n < 100 && !d.querySelector("#bf-state"); n++)
          await settle();
        assert.ok(
          d.querySelector("#bf-state"),
          d.querySelector("#admin-panel").textContent,
        );
      };
      d.querySelector('[data-tab="boards"]').click();
      await ready();
      assert.equal(d.querySelector("#bf-state").value, "");
      assert.equal(d.querySelectorAll('[data-govern="unarchive"]').length, 0);
      assert.ok(
        d
          .querySelector('[role="status"]')
          .textContent.replace(/[\s,]/g, "")
          .includes(String(sample.boards.length - archived)),
      );
      d.querySelector("#bf-export").click();
      for (let n = 0; n < 100 && !exports.length; n++) await settle();
      assert.equal(exports.length, 1);
      assert.equal(
        exports[0][0].split("\n").length,
        sample.boards.length - archived + 1,
      );
      const apply = (state) => {
        d.querySelector("#bf-state").value = state;
        d.querySelector("#board-filters").dispatchEvent(
          new window.Event("submit", { cancelable: true }),
        );
      };
      apply("archived");
      await ready();
      assert.equal(
        d.querySelectorAll('[data-govern="unarchive"]').length,
        archived,
      );
      assert.equal(d.querySelectorAll('[data-govern="archive"]').length, 0);
      apply("deleted");
      await ready();
      assert.equal(d.querySelectorAll('[data-govern="restore"]').length, 1);
      apply("");
      await ready();
      assert.equal(d.querySelectorAll('[data-govern="unarchive"]').length, 0);
    },
    (op, input) => org.request(op, input),
  );
});

test("directory search reaches the last person, resets paging, retains search after tab navigation, and exports all 500 people", async () => {
  await withPeople(async ({ d, data, exports, window, settle }) => {
    d.querySelector("#people-next").click();
    const search = d.querySelector("#people-search");
    search.value = "  person-500@example.test  ";
    search.dispatchEvent(new window.Event("input"));
    assert.equal(
      d.querySelector("[data-role]").dataset.role,
      data.users[499].uuid,
    );
    assert.equal(d.querySelector("#people-pages").hidden, true);
    assert.equal(
      d.querySelector("#people-count").textContent,
      "Showing people 1–1 of 1.",
    );
    d.querySelector("#export-people").click();
    // A heading, the account owner, and the 500 people.
    assert.equal(exports[0][0].split("\n").length, 502);
    assert.ok(exports[0][0].includes(data.users[0].email));
    assert.ok(exports[0][0].includes(data.users[499].email));
    d.querySelector('[data-tab="security"]').click();
    await settle();
    d.querySelector('[data-tab="people"]').click();
    await settle();
    assert.equal(d.querySelector("#people-search").value, search.value);
    assert.equal(
      d.querySelector("[data-role]").dataset.role,
      data.users[499].uuid,
    );
    d.querySelector("#people-search").value = "no such person";
    d.querySelector("#people-search").dispatchEvent(new window.Event("input"));
    assert.equal(d.querySelectorAll("[data-role]").length, 0);
    assert.equal(
      d.querySelector("#people-count").textContent,
      "No people match your search.",
    );
  });
});

test("directory paging retains keyboard focus at both ends and renders French summaries", async () => {
  await withPeople(async ({ d, setLanguage }) => {
    const next = d.querySelector("#people-next"),
      previous = d.querySelector("#people-prev");
    next.focus();
    for (let n = 0; n < 9; n++) next.click();
    assert.equal(document.activeElement, previous);
    assert.equal(
      d.querySelector("#people-count").textContent,
      "Showing people 451–500 of 500.",
    );
    for (let n = 0; n < 9; n++) previous.click();
    assert.equal(document.activeElement, next);
    setLanguage("fr");
    next.click();
    assert.equal(
      d.querySelector("#people-count").textContent,
      "Personnes 51–100 sur 500.",
    );
  });
});

test("paging during a pending person edit cannot duplicate the change or leave a stale visible value", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  await withPeople(
    async ({ d, data, window, settle, calls }) => {
      const person = byName(data.users)[1];
      const id = person.uuid;
      const role = d.querySelector(`[data-role="${id}"]`);
      role.value = "guest";
      role.dispatchEvent(new window.Event("change"));
      d.querySelector("#people-next").click();
      d.querySelector("#people-prev").click();
      const visible = d.querySelector(`[data-role="${id}"]`);
      assert.equal(visible.disabled, true);
      assert.equal(
        visible.value,
        "guest",
        "pending edits keep the chosen value visible",
      );
      resolve({ user: { ...person, role: "guest" } });
      await settle();
      assert.equal(visible.value, "guest");
      assert.equal(visible.disabled, false);
      assert.equal(calls.filter((c) => c.op === "org.users.update").length, 1);
      assert.equal(d.querySelector(`[data-status="${id}"]`).disabled, false);
    },
    (op) => (op === "org.users.update" ? pending : undefined),
  );
});

test("team membership bounds checkboxes at 500 users and searches members outside the directory page", async () => {
  await withPeople(async ({ d, data, window }) => {
    d.querySelector("#new-team").click();
    assert.equal(
      d.querySelectorAll("#team-list input[type=checkbox]").length,
      50,
    );
    const search = d.querySelector("#team-member-search");
    search.value = data.users[499].email;
    search.dispatchEvent(new window.Event("input"));
    assert.equal(
      d.querySelectorAll("#team-list input[type=checkbox]").length,
      1,
    );
    assert.equal(
      d.querySelector("#team-list input[type=checkbox]").value,
      data.users[499].uuid,
    );
  });
});

test("team membership saves choices across pages and search while preserving deactivated and unknown members", async () => {
  await withPeople(
    async ({ d, data, window, calls, settle }) => {
      d.querySelector('[data-edit-team="team-0"]').click();
      const original = data.teams[0].members;
      const first = d.querySelector("#team-list input[type=checkbox]");
      const added = first.value;
      first.checked = true;
      first.dispatchEvent(new window.Event("change", { bubbles: true }));
      d.querySelector("#team-member-next").click();
      const search = d.querySelector("#team-member-search");
      search.value = data.users[20].email;
      search.dispatchEvent(new window.Event("input"));
      const removed = d.querySelector("#team-list input[type=checkbox]");
      assert.equal(removed.checked, true);
      removed.checked = false;
      removed.dispatchEvent(new window.Event("change", { bubbles: true }));
      search.value = "";
      search.dispatchEvent(new window.Event("input"));
      assert.equal(
        d.querySelector(`#team-list input[value="${added}"]`).checked,
        true,
      );
      d.querySelector("#team-list > form").dispatchEvent(
        new window.Event("submit", { cancelable: true }),
      );
      await settle();
      // Only who joined and left is sent: deactivated and unlisted
      // members are not removed.
      const sent = calls.find((c) => c.op === "teams.update").input;
      assert.ok(original.includes(data.users[20].uuid));
      assert.deepEqual(sent.add, original.includes(added) ? [] : [added]);
      assert.deepEqual(sent.remove, [data.users[20].uuid]);
      assert.ok(
        !sent.remove.includes(data.users[0].uuid),
        "deactivated member retained",
      );
      assert.ok(
        !sent.remove.includes("unknown-member"),
        "unlisted member retained",
      );
    },
    (op, input, data) => {
      if (op === "teams.list") data.teams[0].members.push("unknown-member");
    },
  );
});

test("team paging retains focus, announces selection in French, and an unsuccessful save preserves the draft", async () => {
  await withPeople(
    async ({ d, data, window, setLanguage, settle, calls }) => {
      d.querySelector("#new-team").click();
      const form = d.querySelector("#team-list > form");
      form.querySelector("#team-name").value = "Sample draft";
      const first = form.querySelector('input[type="checkbox"]');
      const chosen = data.users.find((u) => u.uuid === first.value);
      first.checked = true;
      first.dispatchEvent(new window.Event("change", { bubbles: true }));
      setLanguage("fr");
      const next = form.querySelector("#team-member-next"),
        previous = form.querySelector("#team-member-prev");
      next.focus();
      for (let n = 0; n < 9; n++) next.click();
      assert.equal(document.activeElement, previous);
      assert.equal(
        form.querySelector("#team-member-count").textContent,
        "Membres 451–478 sur 478.",
      );
      assert.equal(
        form.querySelector("#team-member-selected").textContent,
        "Membres sélectionnés : 1.",
      );
      form.dispatchEvent(new window.Event("submit", { cancelable: true }));
      assert.equal(form.querySelector("fieldset").disabled, true);
      form.dispatchEvent(new window.Event("submit", { cancelable: true }));
      await settle();
      assert.equal(calls.filter((c) => c.op === "teams.create").length, 1);
      assert.equal(form.querySelector("fieldset").disabled, false);
      assert.equal(form.querySelector("#team-name").value, "Sample draft");
      assert.equal(
        d.querySelector("#admin-error").textContent,
        "Sample failure",
      );
      const search = form.querySelector("#team-member-search");
      search.value = chosen.email;
      search.dispatchEvent(new window.Event("input"));
      assert.equal(form.querySelector('input[type="checkbox"]').checked, true);
      form.querySelector("#team-cancel").click();
      assert.equal(document.activeElement.id, "new-team");
    },
    (op) => {
      if (op === "teams.create") throw Error("Sample failure");
    },
  );
});
