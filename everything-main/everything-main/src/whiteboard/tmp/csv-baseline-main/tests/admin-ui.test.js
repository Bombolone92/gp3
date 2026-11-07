import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import axe from "axe-core";

// Organization settings rendered against a fake organization: every tab
// loads, saves through the organization worker, and passes axe checks.
test("organization settings tabs render, save, and are accessible", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  for (const key of [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "Node",
    "Event",
  ])
    globalThis[key] = w[key];
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new w.Event("close"));
  };
  const { createAdminConsole } =
    await import("../src/organization/admin-ui.js");
  const { normalizePolicy } = await import("../worker/org.js");
  const calls = [];
  const day = (n) => ({
    date: `2026-09-${String(n).padStart(2, "0")}`,
    value: n,
  });
  const responses = {
    "org.reports": {
      generated: Date.now(),
      days: 30,
      users: {
        total: 3,
        active: 3,
        deactivated: 0,
        pending: 1,
        guests: 1,
        admins: 1,
        activeLast30Days: 2,
        inactive: [{ uuid: "u3", username: "cam", lastActive: null }],
      },
      usage: {
        dailyActiveUsers: [day(1), day(2)],
        peakConcurrent: [day(1), day(2)],
        minutesPerDay: [day(1), day(2)],
      },
      boards: {
        total: 2,
        archived: 0,
        deleted: 0,
        activeLast30Days: 1,
        stale: 1,
        empty: 0,
        createdByWeek: [{ week: "2026-09-01", created: 2 }],
        topOwners: [{ uuid: "u1", username: "alice", count: 2 }],
        largest: [],
      },
      sharing: {
        organizationVisible: 1,
        publicLinks: 0,
        withGuests: 1,
        guestMemberships: 1,
        boardsWithGuests: [
          { room: "r1", title: "Kickoff", guests: 1, visibility: "private" },
        ],
      },
      sessions: {
        largest: [
          { room: "r1", title: "Kickoff", participants: 120, at: Date.now() },
        ],
        sessionsOver50: 1,
      },
      feedback: {
        responses: 2,
        averageEase: 4.5,
        // Numbers from the organization's server never become markup.
        distribution: ['<img id="pwn-count">', 0, 0, 1, 1],
        recent: [{ at: 1, ease: '<img id="pwn-ease">', comment: "Great" }],
      },
    },
    "org.users.list": {
      owner: { uuid: "u1", username: "alice" },
      users: [
        {
          uuid: "u2",
          username: "bob",
          email: "bob@cds-snc.ca",
          emailVerified: true,
          role: "member",
          status: "active",
          teams: ["t1"],
          lastActive: Date.now(),
        },
        {
          uuid: "pending-1",
          email: "dee@cds-snc.ca",
          role: "member",
          status: "pending",
          teams: [],
        },
      ],
    },
    "teams.list": { teams: [{ id: "t1", name: "Design", members: ["u2"] }] },
    // Space names come from members, so they must render as text.
    "spaces.list": {
      spaces: [{ id: "s1", name: 'Discovery</select><img id="pwn" src="x">' }],
    },
    "org.boards": {
      boards: [
        {
          room: "r1",
          title: "Kickoff",
          owner: "u1",
          ownerName: "alice",
          created: 1,
          lastActivity: Date.now(),
          objectCount: 40,
          visibility: "organization",
          guestCount: 1,
        },
      ],
    },
    "org.policy.get": {
      policy: normalizePolicy({ name: "CDS", domains: ["cds-snc.ca"] }),
      secrets: {
        slack: false,
        jira: true,
        sentinel: false,
        "siem-token": false,
      },
      siem: null,
      owner: { uuid: "u1", username: "alice" },
    },
    "apikeys.list": {
      keys: [
        {
          id: "k1",
          name: "SCIM",
          scopes: ["scim"],
          prefix: "wbk_abcd1234",
          created: 1,
          lastUsed: null,
          expires: null,
        },
      ],
      scopes: ["scim", "audit:read"],
    },
    "webhooks.list": {
      webhooks: [
        {
          id: "h1",
          url: "https://hooks.example.ca/x",
          events: ["*"],
          enabled: true,
        },
      ],
      events: ["*", "board"],
      pending: 0,
    },
    "org.audit": {
      entries: [
        {
          id: "a1",
          at: Date.now(),
          time: new Date().toISOString(),
          category: "sharing",
          action: "board.visibility.link",
          actor: { username: "bob" },
          target: { type: "board", id: "r1", name: "Kickoff" },
          details: { to: "link" },
        },
      ],
      cursor: null,
    },
  };
  const org = {
    server: "https://whiteboard-abc.puter.work",
    isAdmin: true,
    request: async (op, data) => {
      calls.push([op, data]);
      return responses[op] || { ok: true, policy: {} };
    },
    refresh: async () => {},
  };
  const downloads = [];
  const modal = (title, html, ready) => {
    const d = document.createElement("dialog");
    d.setAttribute("aria-label", title);
    d.innerHTML = `<div class="dialog-header"><h2>${title}</h2></div>${html}`;
    document.body.append(d);
    d.showModal();
    ready?.(d);
    return d;
  };
  const admin = createAdminConsole({
    org,
    modal,
    toast: () => {},
    icon: () => "",
    download: (...args) => downloads.push(args),
    migrate: () => {},
  });
  const d = admin.open();
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const panel = () => d.querySelector("#admin-panel");
  const audit = async (label) => {
    w.eval(axe.source);
    const result = await w.axe.run(d, {
      rules: { "color-contrast": { enabled: false } },
    });
    assert.deepEqual(
      Array.from(
        result.violations,
        (v) => `${label}: ${v.id}: ${v.nodes[0]?.html}`,
      ),
      [],
    );
  };
  await settle();
  assert.match(panel().textContent, /Daily active users/);
  assert.match(panel().textContent, /Ease of use/);
  assert.equal(
    d.querySelector('[aria-selected="true"]').dataset.tab,
    "overview",
  );
  await audit("overview");
  assert.equal(d.querySelector("#pwn-count, #pwn-ease"), null);
  // A count of one is singular.
  assert.match(panel().textContent, /1 guest membership(?!s)/);
  assert.match(panel().textContent, /1 session with 50 or more people/);
  assert.match(panel().textContent, /1 active in the last 30 days/);
  assert.match(panel().textContent, /2 ratings out of 5/);
  // The inactive users export holds everyone, even past the people the
  // report lists.
  panel().querySelector("#report-users").click();
  await settle();
  assert.match(
    downloads.at(-1)[0],
    /^\ufeff?username,email,lastActive\r\ncam,/,
  );
  const report = responses["org.reports"];
  report.users.inactiveCount = 2;
  const ask = org.request;
  org.request = async (op, data) =>
    op === "org.reports" && data?.allInactive
      ? {
          ...report,
          users: {
            ...report.users,
            inactive: [...report.users.inactive, { username: "dee" }],
          },
        }
      : ask(op, data);
  panel().querySelector("#report-users").click();
  await settle();
  org.request = ask;
  delete report.users.inactiveCount;
  assert.match(downloads.at(-1)[1], /inactive-users\.csv/);
  assert.match(downloads.at(-1)[0], /\r\ndee,/);
  // Each chart is one tab stop; arrow keys move between its bars.
  const chart = panel().querySelector(".admin-chart svg");
  const stops = () => [...chart.querySelectorAll('.chart-bar[tabindex="0"]')];
  assert.equal(stops().length, 1);
  assert.equal(stops()[0], [...chart.querySelectorAll(".chart-bar")].at(-1));
  stops()[0].focus();
  stops()[0].dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
  );
  assert.equal(stops().length, 1);
  assert.equal(d.ownerDocument.activeElement, stops()[0]);
  assert.equal(stops()[0], [...chart.querySelectorAll(".chart-bar")].at(-2));
  stops()[0].dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
  );
  assert.equal(stops()[0], chart.querySelector(".chart-bar"));
  // Arrow keys move between tabs.
  d.querySelector('[data-tab="overview"]').dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  await settle();
  assert.equal(d.querySelector('[aria-selected="true"]').dataset.tab, "people");
  assert.match(panel().textContent, /bob@cds-snc\.ca/);
  assert.match(panel().textContent, /1 member(?!s)/);
  assert.match(panel().textContent, /awaiting sign-in/);
  const role = panel().querySelector('[data-role="u2"]');
  role.value = "guest";
  role.dispatchEvent(new w.Event("change"));
  await settle();
  assert.deepEqual(calls.at(-1), [
    "org.users.update",
    { uuid: "u2", role: "guest" },
  ]);
  await audit("people");
  for (const tab of [
    "boards",
    "policies",
    "integrations",
    "security",
    "audit",
  ]) {
    d.querySelector(`[data-tab="${tab}"]`).click();
    await settle();
    assert.ok(!panel().querySelector('[role="alert"]'), `${tab} loads`);
    assert.equal(d.querySelector("#pwn"), null, `${tab} escapes names`);
    await audit(tab);
    if (tab === "boards")
      assert.match(panel().textContent, /1 board(?!s)[^]*1 guest(?!s)/);
    if (tab === "security") {
      // Webhook addresses break anywhere like the other technical values,
      // and the tables scroll on their own, so neither widens the dialog
      // on a phone.
      assert.equal(
        panel().querySelector("code[data-user-content]:not(dd code)")
          ?.textContent,
        "https://hooks.example.ca/x",
      );
      for (const table of panel().querySelectorAll(".admin-table"))
        assert.ok(table.parentElement.matches(".table-scroll"));
    }
    if (tab === "boards")
      // Team and space names are kept as written in any language.
      for (const id of ['#bf-team [value="t1"]', '#bf-space [value="s1"]'])
        assert.ok(panel().querySelector(id).hasAttribute("data-user-content"));
  }
  // Saving policies sends the whole policy form.
  d.querySelector('[data-tab="policies"]').click();
  await settle();
  panel().querySelector("#p-ai").checked = false;
  panel()
    .querySelector("#policy-form")
    .dispatchEvent(new w.Event("submit", { cancelable: true }));
  await settle();
  const saved = calls.find(([op]) => op === "org.policy.set");
  assert.equal(saved[1].policy.ai.enabled, false);
  assert.deepEqual(saved[1].policy.domains, ["cds-snc.ca"]);
  // The audit log exports CSV.
  d.querySelector('[data-tab="audit"]').click();
  await settle();
  panel().querySelector("#au-csv").click();
  await settle();
  assert.match(downloads.at(-1)[0], /board\.visibility\.link/);
  dom.window.close();
  for (const key of [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "Node",
    "Event",
  ])
    delete globalThis[key];
});

test("the join dialog also leads to setting up an organization", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const titles = [];
    const home = createOrganizationHome({
      org: { info: null, onChange() {}, request: async () => ({}) },
      modal: (title, html, ready) => {
        titles.push(title);
        const dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        dialog.close = () => dialog.remove();
        document.body.append(dialog);
        ready(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    home.joinDialog();
    document.querySelector("#org-join-setup").click();
    assert.deepEqual(titles, [
      "Join an organization",
      "Set up an organization",
    ]);
    assert.equal(document.querySelectorAll("dialog").length, 1);
    // Phones keep Join an organization, the way to both.
    const css = readFileSync(
      new URL("../src/organization/organization.css", import.meta.url),
      "utf8",
    );
    assert.ok(!/\.sidebar \.org-start\s*\{\s*display:\s*none/.test(css));
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("scrolling admin tables keep their hidden headings inside them", () => {
  // Screen reader only headings are absolutely positioned; without a
  // positioned scroll box they escape it and widen the dialog on phones.
  const css = readFileSync(
    new URL("../src/organization/organization.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.table-scroll\s*\{[^}]*position:\s*relative/);
  const source = readFileSync(
    new URL("../src/organization/admin-ui.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /class="table-scroll"[^]*class="sr-only"/);
});

test("notifications are worded in the reader's language", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage } = await import("../src/i18n.js");
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    // The app loads planning's strings at start.
    await import("../src/planning/i18n.js");
    setLanguage("fr");
    const items = [
      {
        id: "1",
        type: "assignment",
        at: Date.UTC(2026, 8, 26, 12),
        actor: { username: "Bob" },
        title: "Draft the brief",
        due: "2026-10-01",
        text: "Bob: Draft the brief (due 2026-10-01)",
      },
      {
        id: "2",
        type: "alert",
        at: Date.UTC(2026, 8, 26, 12),
        label: "A guest joined a board",
        who: "Dee",
        target: "Plan",
        text: 'A guest joined a board: Dee "Plan" (2026-09-26T12:00:00Z)',
      },
      {
        id: "4",
        type: "assignment",
        at: Date.UTC(2026, 8, 26, 12),
        actor: { username: "Bob" },
        title: "Untitled task",
        more: 3,
      },
      // Saved before notifications carried their parts.
      { id: "3", type: "mention", at: 0, text: "Alice: hello" },
      {
        id: "5",
        type: "reply",
        at: 0,
        read: true,
        actor: { username: "Cam" },
        excerpt: "Merci",
        text: "Cam: Merci",
      },
      {
        id: "6",
        type: "assignment",
        at: 0,
        read: true,
        anonymous: true,
        title: "Revue",
        text: "A participant: Revue",
      },
    ];
    let dialog;
    const home = createOrganizationHome({
      org: {
        info: { name: "CDS", role: "member", user: {} },
        onChange() {},
        request: async (op) =>
          op === "notifications.list" ? { items, unread: 4 } : {},
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
      async openShared() {},
    });
    await home.notifications();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(
      [...dialog.querySelectorAll("[data-user-content]")].map(
        (s) => s.textContent,
      ),
      [
        // French sets a colon apart with a space.
        "Bob : Draft the brief (échéance le 1 oct. 2026)",
        "Un invité s’est joint à un tableau : Dee « Plan »",
        "Bob : Tâche sans titre et 3 autres",
        "Alice: hello",
        "Cam : Merci",
        "Un participant : Revue",
      ],
    );
    // The sidebar's count is read out with its meaning.
    const aside = document.createElement("aside");
    aside.innerHTML = home.sidebar();
    document.body.append(aside);
    home.bind(aside);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const button = aside.querySelector('[data-org-action="notifications"]');
    assert.equal(
      button.querySelector(".nav-badge [aria-hidden]").textContent,
      "4",
    );
    assert.equal(
      button.querySelector(".nav-badge .sr-only").textContent,
      "4 non lues",
    );
    // Unread notifications say so, not only in bold.
    assert.deepEqual(
      [...dialog.querySelectorAll(".unread .notification .sr-only")].map(
        (s) => s.textContent,
      ),
      ["Non lue", "Non lue", "Non lue", "Non lue"],
    );
    // Notifications about no board are text, not disabled buttons.
    assert.equal(dialog.querySelector(".notification[disabled]"), null);
    assert.equal(dialog.querySelector('[data-note="2"]').tagName, "DIV");
    // Only a count is announced, not each notification.
    assert.equal(dialog.querySelector("[aria-live]"), null);
    assert.equal(
      dialog.querySelector("#notification-count").textContent,
      "6 notifications",
    );
  } finally {
    setLanguage("en");
    for (const key of keys) delete globalThis[key];
    delete globalThis.localStorage;
  }
});

test("the unread badge counts the notifications the dialog lists and drops one once it is opened", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const items = [
      { id: "1", type: "mention", at: 2, board: "r1", thread: "c1" },
      { id: "2", type: "mention", at: 1, board: "r1", thread: "c2" },
    ];
    const limits = [];
    let dialog;
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { name: "CDS", role: "member", user: {} },
        onChange() {},
        request: async (op, input) => {
          if (op === "notifications.read")
            for (const n of items) if (input.ids.includes(n.id)) n.read = true;
          if (op !== "notifications.list") return {};
          limits.push(input.limit);
          return { items, unread: items.filter((n) => !n.read).length };
        },
      },
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.close = () => {};
        dialog.innerHTML = html;
        document.body.append(dialog);
        ready(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      // Opening the board fails, so the library stays on screen.
      openShared: async () => {
        throw Error("Board not found.");
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    const aside = document.createElement("aside");
    aside.innerHTML = home.sidebar();
    document.body.append(aside);
    home.bind(aside);
    await settle();
    const badge = () =>
      aside.querySelector(".nav-badge [aria-hidden]")?.textContent;
    assert.equal(badge(), "2");
    await home.notifications();
    await settle();
    dialog.querySelector('[data-note="1"]').click();
    await settle();
    assert.equal(badge(), "1");
    assert.ok(limits.length >= 3);
    assert.ok(new Set(limits).size === 1, `limits ${limits}`);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("a notification opens the task or comment it is about", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const items = [
      { id: "1", type: "assignment", at: 1, board: "r1", item: "task1" },
      { id: "2", type: "mention", at: 1, board: "r1", thread: "c1" },
    ];
    const opened = [];
    let dialog;
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { name: "CDS", role: "member", user: {} },
        onChange() {},
        request: async (op) => (op === "notifications.list" ? { items } : {}),
      },
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.close = () => {};
        dialog.innerHTML = html;
        document.body.append(dialog);
        ready(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      openShared: async (...args) => {
        opened.push(args);
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    await home.notifications();
    await settle();
    dialog.querySelector('[data-note="1"]').click();
    await settle();
    dialog.querySelector('[data-note="2"]').click();
    await settle();
    assert.deepEqual(opened, [
      [
        "https://org.puter.work",
        "r1",
        { thread: undefined, objectId: "task1" },
      ],
      ["https://org.puter.work", "r1", { thread: "c1", objectId: undefined }],
    ]);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("the email notification choice shows what is saved", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const toasts = [];
    let dialog,
      offline = true;
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { name: "CDS", role: "member", user: { emailVerified: true } },
        onChange() {},
        refresh: async () => {},
        request: async (op) => {
          if (op === "prefs.set" && offline) throw Error("Network error");
          return op === "notifications.list" ? { items: [] } : {};
        },
      },
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        document.body.append(dialog);
        ready(dialog);
        return dialog;
      },
      toast: (message) => toasts.push(message),
      icon: () => "",
      async openShared() {},
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    await home.notifications();
    const box = dialog.querySelector("#notify-email");
    assert.equal(box.checked, true);
    box.click();
    await settle();
    assert.equal(box.checked, true);
    assert.deepEqual(toasts, ["Network error"]);
    offline = false;
    box.click();
    await settle();
    assert.equal(box.checked, false);
    assert.deepEqual(toasts, ["Network error"]);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("joining from a link confirms the organization before switching", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const used = [];
    const org = {
      server: "https://acme.puter.work",
      info: { name: "ACME", role: "member", configured: true },
      isMember: true,
      onChange() {},
      preview: async (server) => ({ server, info: { name: "ACME Corp" } }),
      use: async (server) => used.push(server),
      request: async () => ({}),
    };
    let dialog;
    const home = createOrganizationHome({
      org,
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        dialog.close = () => dialog.remove();
        document.body.append(dialog);
        ready(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    home.joinDialog("https://whiteboard.test/#org=https://evil.puter.work");
    const submit = () =>
      dialog
        .querySelector("#org-join")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    submit();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(used, [], "nothing changes on the first press");
    assert.match(
      dialog.querySelector("#org-join-status").textContent,
      /ACME Corp at evil\.puter\.work\?.*replaces ACME/,
    );
    submit();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(used, ["https://evil.puter.work"]);
  } finally {
    for (const key of keys) delete globalThis[key];
    dom.window.close();
  }
});

test("a slow organization board search never overwrites a newer one", async () => {
  const dom = new JSDOM("<!doctype html><body><div id='grid'></div></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const pending = [];
    const board = (room, title) => ({ room, title, visibility: "private" });
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { role: "member" },
        isMember: true,
        onChange() {},
        request: (op) =>
          op === "org.boards"
            ? new Promise((resolve) => pending.push(resolve))
            : Promise.resolve({ spaces: [], teams: [] }),
      },
      modal() {},
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    const grid = document.querySelector("#grid");
    const first = home.renderBoards(grid);
    await new Promise((r) => setTimeout(r, 0));
    const second = home.renderBoards(grid);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(pending.length, 2);
    pending[1]({ boards: [board("r1", "Newer")] });
    await second;
    pending[0]({ boards: [board("r2", "Older"), board("r3", "Older too")] });
    await first;
    assert.equal(document.querySelector("#org-count").textContent, "1 board");
    assert.deepEqual(
      [...grid.querySelectorAll(".board-info h3")].map((h) => h.textContent),
      ["Newer"],
    );
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("an admin action that finishes after another tab opened changes nothing", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const entry = (id) => ({
      id,
      at: 1,
      time: new Date(1).toISOString(),
      category: "sharing",
      action: `action.${id}`,
      actor: { username: "bob" },
      target: { type: "board", id: "r1", name: "Kickoff" },
    });
    let release;
    const toasts = [];
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op, data) => {
        if (op === "org.audit" && data.cursor)
          return new Promise((resolve) => (release = resolve));
        if (op === "org.audit") return { entries: [entry("a1")], cursor: "c" };
        if (op === "org.users.list")
          return { owner: { uuid: "u1", username: "alice" }, users: [] };
        if (op === "teams.list") return { teams: [] };
        return {};
      },
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast: (m) => toasts.push(m),
      icon: () => "",
      download() {},
      migrate() {},
    });
    const d = admin.open();
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    d.querySelector('[data-tab="audit"]').click();
    await settle();
    d.querySelector("#au-more").click();
    await settle();
    d.querySelector('[data-tab="people"]').click();
    await settle();
    const before = d.querySelector("#admin-panel").innerHTML;
    release({ entries: [entry("a2")], cursor: null });
    await settle();
    assert.equal(d.querySelector("#admin-panel").innerHTML, before);
    assert.deepEqual(toasts, []);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("an invitation link created after another tab opened shows no error", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "location",
  ];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    let release;
    const toasts = [];
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op) => {
        if (op === "org.invite")
          return new Promise((resolve) => (release = resolve));
        if (op === "org.users.list")
          return { owner: { uuid: "u1", username: "alice" }, users: [] };
        if (op === "teams.list") return { teams: [] };
        if (op === "org.audit") return { entries: [], cursor: null };
        return {};
      },
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast: (m) => toasts.push(m),
      icon: () => "",
      download() {},
    });
    const d = admin.open("people");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    d.querySelector("#invite-people").click();
    await settle();
    d.querySelector('[data-tab="audit"]').click();
    await settle();
    const before = d.querySelector("#admin-panel").innerHTML;
    release({ token: "secret-token" });
    await settle();
    assert.deepEqual(toasts, []);
    assert.equal(d.querySelector("#admin-status").textContent, "");
    assert.equal(d.querySelector("#admin-panel").innerHTML, before);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("the audit log date filters read Du and Au in French", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { setLanguage } = await import("../src/i18n.js");
  try {
    // The app loads the workshop strings, with their own "From" and "To",
    // before the organization ones.
    await import("../src/facilitation/strings.js");
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    setLanguage("fr");
    const admin = createAdminConsole({
      org: {
        server: "https://whiteboard-abc.puter.work",
        isAdmin: true,
        request: async (op) =>
          op === "org.audit" ? { entries: [], cursor: null } : {},
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
    const d = admin.open("audit");
    await new Promise((r) => setTimeout(r, 20));
    const label = (id) =>
      d.querySelector(`#${id}`).closest("label").textContent;
    assert.equal(label("au-from"), "Du");
    assert.equal(label("au-to"), "Au");
    const { t } = await import("../src/i18n.js");
    assert.equal(t("From"), "De");
    assert.equal(t("To"), "À");
    const scrolling = d.querySelector(".table-scroll");
    assert.equal(scrolling.tabIndex, 0);
    assert.equal(scrolling.getAttribute("aria-label"), "Journal d’audit");
    scrolling.focus();
    assert.equal(document.activeElement, scrolling);
  } finally {
    setLanguage("en");
    for (const key of keys) delete globalThis[key];
  }
});

test("the audit log export includes pages not loaded on screen", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const entry = (id) => ({
      id,
      at: 1,
      time: new Date(1).toISOString(),
      category: "sharing",
      action: `action.${id}`,
      actor: { username: "bob" },
      target: { type: "board", id: "r1", name: "Kickoff" },
    });
    const pages = {
      "": { entries: [entry("a3")], cursor: "a3" },
      a3: { entries: [entry("a2")], cursor: "a2" },
      a2: { entries: [entry("a1")], cursor: null },
    };
    const downloads = [];
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op, data) => {
        if (op === "org.audit") return pages[data.cursor || ""];
        if (op === "org.users.list")
          return { owner: { uuid: "u1", username: "alice" }, users: [] };
        if (op === "teams.list") return { teams: [] };
        return {};
      },
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast() {},
      icon: () => "",
      download: (...args) => downloads.push(args),
      migrate() {},
    });
    const d = admin.open();
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    d.querySelector('[data-tab="audit"]').click();
    await settle();
    assert.equal(d.querySelectorAll(".admin-table tbody tr").length, 1);
    const scrolling = d.querySelector(".table-scroll");
    assert.equal(scrolling.tabIndex, 0);
    assert.equal(scrolling.getAttribute("role"), "region");
    assert.equal(scrolling.getAttribute("aria-label"), "Audit log");
    scrolling.focus();
    assert.equal(document.activeElement, scrolling);
    Object.defineProperties(scrolling, {
      clientWidth: { value: 200 },
      scrollWidth: { value: 500 },
    });
    const right = new dom.window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    scrolling.dispatchEvent(right);
    assert.equal(right.defaultPrevented, true);
    assert.ok(scrolling.scrollLeft > 0);
    const left = new dom.window.KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
    });
    scrolling.dispatchEvent(left);
    assert.equal(left.defaultPrevented, true);
    assert.equal(scrolling.scrollLeft, 0);
    for (const options of [
      { key: "Tab" },
      { key: "ArrowRight", ctrlKey: true },
      { key: "ArrowRight", altKey: true },
      { key: "ArrowRight", isComposing: true },
    ]) {
      const event = new dom.window.KeyboardEvent("keydown", {
        ...options,
        bubbles: true,
        cancelable: true,
      });
      scrolling.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(scrolling.scrollLeft, 0);
    }
    const previousContent = scrolling.textContent;
    d.querySelector("#audit-filters").dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await settle();
    const refreshed = d.querySelector(".table-scroll");
    assert.notEqual(refreshed, scrolling);
    assert.equal(refreshed.textContent, previousContent);
    assert.equal(document.activeElement, refreshed);
    d.querySelector("#au-json").click();
    await settle();
    assert.deepEqual(
      JSON.parse(downloads.at(-1)[0]).map((e) => e.id),
      ["a3", "a2", "a1"],
    );
    // Loading the last page removes its button; the keyboard stays in the
    // panel instead of falling back to the page.
    d.querySelector("#au-more").focus();
    d.querySelector("#au-more").click();
    await settle();
    assert.equal(document.activeElement.id, "au-more");
    d.querySelector("#au-more").click();
    await settle();
    assert.equal(d.querySelector("#au-more"), null);
    assert.equal(d.querySelectorAll(".admin-table tbody tr").length, 3);
    assert.equal(document.activeElement, d.querySelector("#admin-panel"));
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("a change finishing after another tab opened keeps that tab open", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    let release;
    const deleted = [];
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op, data) => {
        if (op === "teams.delete") {
          deleted.push(data.id);
          if (deleted.length === 1)
            return new Promise((resolve) => (release = resolve));
          return {};
        }
        if (op === "org.users.list")
          return { owner: { uuid: "u1", username: "alice" }, users: [] };
        if (op === "teams.list")
          return {
            teams: [
              { id: "t1", name: "Design", members: [] },
              { id: "t2", name: "Research", members: [] },
            ],
          };
        if (op === "org.audit") return { entries: [], cursor: null };
        return {};
      },
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
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
    const d = admin.open("people");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    const remove = d.querySelector('[data-delete-team="t1"]');
    remove.click();
    remove.click();
    await settle();
    d.querySelector('[data-tab="audit"]').click();
    await settle();
    release({});
    await settle();
    const selected = () =>
      d.querySelector('[role="tab"][aria-selected="true"]').dataset.tab;
    assert.equal(selected(), "audit");
    assert.ok(d.querySelector("#audit-filters"));
    // A change finishing on its own tab still shows the result.
    d.querySelector('[data-tab="people"]').click();
    await settle();
    const other = d.querySelector('[data-delete-team="t2"]');
    other.click();
    other.click();
    await settle();
    assert.deepEqual(deleted, ["t1", "t2"]);
    assert.equal(selected(), "people");
    assert.ok(d.querySelector('[data-delete-team="t2"]:not([data-confirmed])'));
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("policy numbers, key scopes, and webhook events from the server never become markup", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const w = dom.window;
  const keys = [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "Node",
    "Event",
  ];
  for (const key of keys) globalThis[key] = w[key];
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const { normalizePolicy } = await import("../worker/org.js");
    const policy = normalizePolicy({ name: "CDS" });
    policy.guestExpiryDays = '"><img id="pwn-days">';
    policy.retention.auditDays = '"><img id="pwn-audit">';
    const responses = {
      "org.policy.get": { policy, secrets: {}, siem: null, owner: null },
      "apikeys.list": { keys: [], scopes: ['<img id="pwn-scope">'] },
      "webhooks.list": {
        webhooks: [],
        events: ['"><img id="pwn-event">', '<img id="pwn-code">'],
        pending: 1,
      },
    };
    const admin = createAdminConsole({
      org: {
        server: "https://whiteboard-abc.puter.work",
        isAdmin: true,
        request: async (op) => responses[op] || { ok: true, policy: {} },
        refresh: async () => {},
      },
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        d.showModal();
        ready?.(d);
        return d;
      },
      toast: () => {},
      icon: () => "",
      download: () => {},
      migrate: () => {},
    });
    const d = admin.open();
    const settle = () => new Promise((r) => setTimeout(r, 20));
    for (const tab of ["policies", "security"]) {
      await settle();
      d.querySelector(`[data-tab="${tab}"]`).click();
      await settle();
      assert.equal(d.querySelector('[id^="pwn"]'), null, tab);
    }
    assert.equal(
      d.querySelector('[name="k-scope"]').value,
      '<img id="pwn-scope">',
    );
    assert.match(d.textContent, / 1 delivery waiting to retry\./);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("numbers from the organization's server never become markup", async () => {
  const dom = new JSDOM("<!doctype html><body><div id='grid'></div></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const markup = '<img id="pwn" src="x">';
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { role: "member", name: "CDS", user: { emailVerified: true } },
        onChange() {},
        request: async (op) =>
          op === "notifications.list"
            ? { unread: markup, items: [] }
            : op === "org.boards"
              ? {
                  boards: [
                    {
                      room: "r1",
                      title: "Plan",
                      visibility: "private",
                      objectCount: markup,
                    },
                  ],
                }
              : {},
      },
      modal() {},
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    await home.refreshBadge();
    document.body.insertAdjacentHTML("beforeend", home.sidebar());
    await home.renderBoards(document.querySelector("#grid"));
    assert.equal(document.querySelector("#pwn"), null);
    assert.match(document.querySelector(".org-preview").textContent, /^0 /);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("the organization library lists, approves, removes, uses, and shares templates", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = [
    "document",
    "HTMLElement",
    "Node",
    "Event",
    "NodeFilter",
    "CSS",
  ];
  for (const key of keys) globalThis[key] = dom.window[key];
  globalThis.CSS ??= { escape: (s) => s };
  try {
    const { createOrganizationLibrary } =
      await import("../src/organization/library-ui.js");
    const items = [
      {
        id: "a",
        name: "Retro",
        category: "Agile",
        status: "approved",
        createdByName: "Alice",
        created: 1,
        canRemove: false,
      },
      {
        id: "b",
        name: 'Kickoff <img id="pwn">',
        category: "Workshops",
        description: "From Miro",
        status: "pending",
        createdByName: "Bob",
        created: 2,
        canRemove: true,
      },
    ];
    const calls = [],
      toasts = [],
      used = [];
    const org = {
      isAdmin: true,
      request: async (op, input) => {
        calls.push([op, input]);
        if (op === "library.list") return { items, canPublish: true };
        if (op === "library.get") return { board: '{"v":1}' };
        if (op === "library.submit") return { item: { status: "approved" } };
        return { ok: true };
      },
    };
    const lib = createOrganizationLibrary({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.setAttribute("aria-label", title);
        d.innerHTML = html;
        d.close = () => d.remove();
        document.body.append(d);
        ready(d);
        return d;
      },
      toast: (m) => toasts.push(m),
      icon: () => "",
      useBoard: async (json, name) => used.push([json, name]),
      shareable: () => ({ title: "Plan", items: [] }),
    });
    const settle = () => new Promise((r) => setTimeout(r, 0));
    lib.open();
    await settle();
    const rows = () => [...document.querySelectorAll("[data-item]")];
    assert.equal(document.querySelector("#pwn"), null, "Names are escaped");
    // Items awaiting approval come first, with the actions each allows.
    assert.deepEqual(
      rows().map((r) => r.dataset.item),
      ["b", "a"],
    );
    assert.match(rows()[0].textContent, /Awaiting approval/);
    assert.ok(rows()[0].querySelector("[data-library-approve]"));
    assert.equal(rows()[1].querySelector("[data-library-remove]"), null);
    rows()[0].querySelector("[data-library-approve]").click();
    await settle();
    assert.deepEqual(calls.at(-1), ["library.approve", { id: "b" }]);
    assert.doesNotMatch(rows()[0].textContent, /Awaiting approval/);
    // Removal takes a second press.
    rows()[0].querySelector("[data-library-remove]").click();
    await settle();
    assert.notEqual(calls.at(-1)[0], "library.remove");
    rows()[0].querySelector("[data-library-remove]").click();
    await settle();
    assert.deepEqual(calls.at(-1), ["library.remove", { id: "b" }]);
    assert.deepEqual(
      rows().map((r) => r.dataset.item),
      ["a"],
    );
    // Search filters by name, category, and author.
    const search = document.querySelector("#org-library-search");
    search.value = "zzz";
    search.dispatchEvent(new dom.window.Event("input"));
    assert.equal(rows().length, 0);
    assert.match(
      document.querySelector("#org-library-status").textContent,
      /No library items match/,
    );
    search.value = "agile";
    search.dispatchEvent(new dom.window.Event("input"));
    rows()[0].querySelector("[data-library-use]").click();
    await settle();
    assert.deepEqual(used, [['{"v":1}', "Retro"]]);
    assert.equal(document.querySelector("dialog"), null, "Using closes it");
    // Sharing the open board sends it as a template.
    lib.share();
    assert.equal(document.querySelector("#org-library-name").value, "Plan");
    document
      .querySelector("#org-library-share")
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await settle();
    const [op, input] = calls.at(-1);
    assert.equal(op, "library.submit");
    assert.equal(input.category, "General");
    assert.deepEqual(JSON.parse(input.board), { title: "Plan", items: [] });
    assert.equal(toasts.at(-1), "Shared to the organization library.");
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("the library's default categories read in French", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "HTMLElement", "Event"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { setLanguage } = await import("../src/i18n.js");
  try {
    const { createOrganizationLibrary } =
      await import("../src/organization/library-ui.js");
    setLanguage("fr");
    const item = (id, category) => ({
      id,
      name: id,
      category,
      status: "approved",
      createdByName: "Alice",
      created: 1,
    });
    const lib = createOrganizationLibrary({
      org: {
        request: async () => ({
          items: [
            item("a", "General"),
            item("b", "Migrated from Miro"),
            item("c", "Agile"),
          ],
        }),
      },
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready(d);
        return d;
      },
      toast() {},
      icon: () => "",
    });
    lib.open();
    await new Promise((r) => setTimeout(r, 0));
    const category = (id) =>
      document.querySelector(`[data-item="${id}"] small span`);
    assert.equal(category("a").textContent, "Général");
    assert.equal(category("b").textContent, "Migré depuis Miro");
    // Names people chose stay as written.
    assert.equal(category("c").textContent, "Agile");
    assert.ok(category("c").hasAttribute("data-user-content"));
    assert.ok(!category("a").hasAttribute("data-user-content"));
    const search = document.querySelector("#org-library-search");
    search.value = "général";
    search.dispatchEvent(new dom.window.Event("input"));
    assert.deepEqual(
      [...document.querySelectorAll("[data-item]")].map((r) => r.dataset.item),
      ["a"],
    );
  } finally {
    setLanguage("en");
    for (const key of keys) delete globalThis[key];
  }
});

test("closing an inline people form returns focus to its button", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op) =>
        op === "org.users.list"
          ? {
              owner: { uuid: "u1", username: "alice" },
              users: [
                {
                  uuid: "u2",
                  username: "bob",
                  role: "member",
                  status: "active",
                },
              ],
            }
          : op === "teams.list"
            ? { teams: [{ id: "t1", name: "Design", members: [] }] }
            : op === "org.users.transfer"
              ? { transferred: 1 }
              : {},
      refresh: async () => {},
    };
    const toasts = [];
    const admin = createAdminConsole({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast: (m) => toasts.push(m),
      icon: () => "",
      download() {},
    });
    const d = admin.open("people");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    const transfer = d.querySelector('[data-transfer="u2"]');
    transfer.click();
    d.querySelector("#transfer-go").click();
    await settle();
    assert.equal(d.querySelector("#transfer-target"), null);
    assert.equal(document.activeElement, transfer);
    assert.deepEqual(toasts, ["1 board transferred."]);
    for (const opener of [
      d.querySelector("#new-team"),
      d.querySelector('[data-edit-team="t1"]'),
    ]) {
      opener.click();
      assert.equal(document.activeElement.id, "team-name");
      d.querySelector("#team-cancel").click();
      assert.equal(document.activeElement, opener);
    }
    // Opening another team form replaces the open one.
    d.querySelector("#new-team").click();
    d.querySelector('[data-edit-team="t1"]').click();
    d.querySelector("#new-team").click();
    assert.equal(d.querySelectorAll("#team-list > form").length, 1);
    assert.equal(d.querySelectorAll("#team-name").length, 1);
    assert.equal(document.activeElement.id, "team-name");
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("editing a team keeps its deactivated members", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const sent = [];
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op, data) => {
        if (op === "teams.update") sent.push(data);
        if (op === "org.users.list")
          return {
            owner: { uuid: "u1", username: "alice" },
            users: [
              { uuid: "u2", username: "bob", role: "member", status: "active" },
              {
                uuid: "u3",
                username: "cam",
                role: "member",
                status: "deactivated",
              },
            ],
          };
        if (op === "teams.list")
          return {
            teams: [{ id: "t1", name: "Design", members: ["u2", "u3"] }],
          };
        return {};
      },
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
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
    const d = admin.open("people");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    d.querySelector('[data-edit-team="t1"]').click();
    d.querySelector("#team-name").value = "Design team";
    d.querySelector(".inline-form").dispatchEvent(
      new dom.window.Event("submit", { cancelable: true }),
    );
    await settle();
    assert.deepEqual(sent[0].members.sort(), ["u2", "u3"]);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("people search finds roles and statuses as they are shown in French", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { setLanguage, t } = await import("../src/i18n.js");
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    setLanguage("fr");
    const person = (uuid, username, role, status) => ({
      uuid,
      username,
      role,
      status,
    });
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op) =>
        op === "org.users.list"
          ? {
              owner: { uuid: "u1", username: "alice" },
              users: [
                person("u2", "bob", "guest", "active"),
                person("u3", "cam", "member", "deactivated"),
                person("u4", "dan", "admin", "pending"),
              ],
            }
          : op === "teams.list"
            ? { teams: [] }
            : {},
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
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
    const d = admin.open("people");
    await new Promise((r) => setTimeout(r, 20));
    const search = (text) => {
      const input = d.querySelector("#people-search");
      input.value = text;
      input.dispatchEvent(new dom.window.Event("input"));
      return [...d.querySelectorAll("#people-rows tr")].map(
        (row) => row.querySelector("[data-user-content]")?.textContent,
      );
    };
    assert.deepEqual(search("Invité"), ["bob"]);
    assert.deepEqual(search("désactivé"), ["cam"]);
    assert.deepEqual(search("administrateur"), ["dan"]);
    assert.deepEqual(search("en attente"), ["dan"]);
    // The stored values still match, as before.
    assert.deepEqual(search("guest"), ["bob"]);
    // One person's status reads in the singular.
    search("");
    assert.equal(
      d.querySelector('[data-status="u3"] option[value="deactivated"]')
        .textContent,
      "Désactivé",
    );
    assert.equal(t("Deactivated"), "Désactivés");
  } finally {
    setLanguage("en");
    for (const key of keys) delete globalThis[key];
  }
});

test("administrators see that their changes were saved", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const on = { enabled: true };
    const toasts = [];
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op) =>
        op === "org.policy.get"
          ? {
              policy: {
                integrations: {
                  google: on,
                  slack: on,
                  jira: { enabled: false, site: "", email: "", project: "" },
                  embeds: on,
                  webhooks: on,
                  miro: on,
                },
              },
              secrets: {},
            }
          : {},
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast: (m) => toasts.push(m),
      icon: () => "",
      download() {},
    });
    const d = admin.open("integrations");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    d.querySelector("#integrations-form").dispatchEvent(
      new dom.window.Event("submit", { cancelable: true }),
    );
    await settle();
    assert.deepEqual(toasts, ["Integrations saved."]);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("organization boards hide archived boards until they are asked for", async () => {
  const dom = new JSDOM("<!doctype html><body><div id='grid'></div></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "HTMLElement", "Node", "Event", "NodeFilter"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const { filterBoards } = await import("../worker/admin.js");
    const rows = [
      { room: "r1", title: "Live", visibility: "private" },
      { room: "r2", title: "Old", visibility: "private", archived: 1 },
    ];
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { role: "member", user: { emailVerified: true } },
        isMember: true,
        onChange() {},
        request: async (op, data) =>
          op === "org.boards"
            ? { boards: filterBoards(structuredClone(rows), data) }
            : { spaces: [], teams: [] },
      },
      modal() {},
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    const grid = document.querySelector("#grid");
    const titles = () =>
      [...grid.querySelectorAll(".board-info h3")].map((h) => h.textContent);
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await home.renderBoards(grid);
    assert.equal(grid.querySelector("#of-archived").value, "");
    assert.deepEqual(titles(), ["Live"]);
    const archived = grid.querySelector("#of-archived");
    archived.value = "only";
    grid.querySelector("#of-query").focus();
    grid
      .querySelector("#org-filters")
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await settle();
    assert.deepEqual(titles(), ["Old"]);
    // The card's name is only its title, so what the card shows about the
    // board, such as being archived, is read as its description.
    const open = grid.querySelector("[data-org-open]");
    const described = open
      .getAttribute("aria-describedby")
      .split(" ")
      .map((id) => document.getElementById(id).textContent)
      .join(" ");
    assert.match(described, /Archived/);
    assert.equal(
      document.activeElement.id,
      "of-query",
      "Searching keeps the keyboard in the search field",
    );
    grid.querySelector("#of-clear").focus();
    grid.querySelector("#of-clear").click();
    await settle();
    assert.deepEqual(titles(), ["Live"]);
    assert.ok(
      document.activeElement.matches(".org-more summary"),
      "Clearing filters moves the keyboard to More filters",
    );
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("board filters agree with their French labels", async () => {
  const dom = new JSDOM("<!doctype html><body><div id='grid'></div></body>", {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "HTMLElement", "Node", "Event"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { setLanguage } = await import("../src/i18n.js");
  try {
    const { createOrganizationHome } =
      await import("../src/organization/home-ui.js");
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    setLanguage("fr");
    const org = {
      server: "https://org.puter.work",
      info: { role: "admin", user: { emailVerified: true } },
      isMember: true,
      isAdmin: true,
      onChange() {},
      request: async (op) =>
        op === "org.boards"
          ? { boards: [] }
          : op === "spaces.list"
            ? { spaces: [] }
            : { teams: [] },
      refresh: async () => {},
    };
    const home = createOrganizationHome({
      org,
      modal() {},
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    const grid = document.querySelector("#grid");
    await home.renderBoards(grid);
    const text = (root, selector) => root.querySelector(selector).textContent;
    const admin = createAdminConsole({
      org,
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
    const d = admin.open("boards");
    await new Promise((r) => setTimeout(r, 20));
    for (const [root, prefix] of [
      [grid, "of"],
      [d, "bf"],
    ]) {
      // Un espace, une équipe, une activité.
      assert.equal(text(root, `#${prefix}-space option[value=""]`), "Tous");
      assert.equal(text(root, `#${prefix}-team option[value=""]`), "Toutes");
      assert.equal(
        text(root, `#${prefix}-activity option[value="active"]`),
        "Actifs au cours des 30 derniers jours",
      );
    }
    // Archived boards, beside current and deleted ones.
    assert.equal(
      grid.querySelector("#of-archived").closest("label").firstChild
        .textContent,
      "Archivés",
    );
    assert.deepEqual(
      [...d.querySelectorAll("#bf-state option")].map((o) => o.textContent),
      ["Actuels", "Archivés", "Supprimés (récupérables)"],
    );
  } finally {
    setLanguage("en");
    for (const key of keys) delete globalThis[key];
  }
});

test("board date filters mean the start of the chosen day where the person is", async () => {
  const { boardFilters } = await import("../src/organization/client.js");
  const { filterBoards } = await import("../worker/admin.js");
  const sent = boardFilters({ updatedAfter: "2026-09-27", scope: "all" });
  assert.equal(
    sent.updatedAfter,
    new Date("2026-09-27T00:00:00").toISOString(),
  );
  assert.equal(sent.scope, "all");
  assert.deepEqual(boardFilters({ scope: "mine" }), { scope: "mine" });
  // A board updated just before local midnight is left out, one just
  // after it is kept.
  const midnight = new Date("2026-09-27T00:00:00").getTime();
  const rows = [
    { room: "before", title: "A", lastActivity: midnight - 60_000 },
    { room: "after", title: "B", lastActivity: midnight + 60_000 },
  ];
  assert.deepEqual(
    filterBoards(rows, sent).map((b) => b.room),
    ["after"],
  );
});

test("the board directory shows how many boards matched and exports them all", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const all = Array.from({ length: 1500 }, (_, n) => ({
      room: `r${n}`,
      title: `Board ${n}`,
      owner: "u1",
      created: 1,
    }));
    const requests = [],
      downloads = [];
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op, data) => {
        if (op === "org.boards") {
          requests.push(data);
          const offset = data.offset || 0;
          return {
            boards: all.slice(offset, offset + (data.limit || 200)),
            total: all.length,
          };
        }
        if (op === "teams.list") return { teams: [] };
        if (op === "spaces.list") return { spaces: [] };
        if (op === "org.users.list")
          return { owner: { uuid: "u1", username: "alice" }, users: [] };
        return {};
      },
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
      modal: (title, html, ready) => {
        const d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast() {},
      icon: () => "",
      download: (...args) => downloads.push(args),
      migrate() {},
    });
    const d = admin.open();
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    d.querySelector('[data-tab="boards"]').click();
    await settle();
    const status = () =>
      d.querySelector("#admin-panel [role=status]").textContent;
    assert.match(status(), /Showing 200 of 1,500 boards/);
    assert.equal(d.querySelectorAll(".admin-table tbody tr").length, 200);
    d.querySelector("#bf-more").click();
    await settle();
    assert.match(status(), /Showing 400 of 1,500 boards/);
    d.querySelector("#bf-export").click();
    await settle();
    const csv = downloads.at(-1)[0];
    assert.equal(csv.trim().split(/\r?\n/).length, 1 + 1500);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("board activity and duplicate results are announced", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    let groups = [
      {
        reason: "same name",
        boards: [
          { title: "Plan", objectCount: 1 },
          { title: "Plan", objectCount: 2 },
        ],
      },
    ];
    const entry = { at: 1, category: "content", action: "board.edit" };
    const org = {
      server: "https://whiteboard-abc.puter.work",
      isAdmin: true,
      request: async (op) =>
        op === "org.boards"
          ? { boards: [{ room: "r1", title: "Plan", created: 1 }], total: 1 }
          : op === "org.board.activity"
            ? { entries: [entry, entry, entry] }
            : op === "org.boards.duplicates"
              ? { groups }
              : op === "teams.list"
                ? { teams: [] }
                : op === "spaces.list"
                  ? { spaces: [] }
                  : {},
      refresh: async () => {},
    };
    const admin = createAdminConsole({
      org,
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
    const d = admin.open("boards");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    const announced = () => d.querySelector("#admin-status").textContent;
    d.querySelector('[data-activity="r1"]').click();
    await settle();
    assert.equal(announced(), "Board activity: 3 events.");
    d.querySelector("#bf-duplicates").click();
    await settle();
    assert.equal(announced(), "1 set of possible duplicates found.");
    groups = [];
    d.querySelector("#bf-duplicates").click();
    await settle();
    assert.equal(announced(), "No duplicates found.");
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("archiving a board from its settings makes it read-only at once", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    let archived = false;
    const s = {
      role: "owner",
      readOnly: false,
      server: "https://whiteboard-abc.puter.work",
      settings: {
        visibility: "private",
        orgRole: "editor",
        linkRole: "viewer",
      },
      request: async (op) => {
        if (op === "archive" || op === "unarchive") {
          archived = op === "archive";
          return { settings: { ...s.settings, archived } };
        }
        return op === "members"
          ? { members: [] }
          : op === "settings.get"
            ? { settings: {} }
            : {};
      },
      heartbeat: async () => {
        s.readOnly = archived;
      },
    };
    let d;
    const toasts = [];
    const access = createBoardAccess({
      org: { info: null, policy: () => null, allows: () => true },
      session: () => s,
      board: () => ({ items: [] }),
      modal: (title, html, ready) => {
        d = document.createElement("dialog");
        d.close = () => d.remove();
        d.innerHTML = html;
        document.body.append(d);
        ready(d);
        return d;
      },
      toast: (message) => toasts.push(message),
      icon: () => "",
    });
    await access.settings();
    d.querySelector("#bs-archive").click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.readOnly, true);
    assert.equal(toasts.at(-1), "Board archived. It is now read-only.");
    await access.settings();
    d.querySelector("#bs-archive").click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.readOnly, false);
    assert.equal(toasts.at(-1), "Board unarchived. It can be edited again.");
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("saving board settings sends only what was changed in the dialog", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    const sent = [];
    const s = {
      role: "facilitator",
      server: "https://whiteboard-abc.puter.work",
      settings: { visibility: "link", orgRole: "editor", linkRole: "viewer" },
      request: async (op, input) => {
        if (op === "settings") {
          sent.push(input);
          return { settings: { ...s.settings, ...input } };
        }
        return op === "members"
          ? { members: [] }
          : op === "settings.get"
            ? { settings: {} }
            : {};
      },
    };
    let d;
    const access = createBoardAccess({
      org: { info: null, policy: () => null, allows: () => true },
      session: () => s,
      board: () => ({ items: [] }),
      modal: (title, html, ready) => {
        d = document.createElement("dialog");
        d.close = () => d.remove();
        d.innerHTML = html;
        document.body.append(d);
        ready(d);
        return d;
      },
      toast() {},
      icon: () => "",
    });
    await access.settings();
    const save = () =>
      d
        .querySelector("#board-settings")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    // Someone else makes the board private meanwhile; this person only
    // changes the link role, so the board stays private.
    d.querySelector("#bs-link-role").value = "commenter";
    save();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(sent, [{ linkRole: "commenter" }]);
    d.querySelector("#bs-org-role").value = "viewer";
    save();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(sent.at(-1), { orgRole: "viewer" });
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("board settings announce the delete confirmation and keep an administrator's owner controls after a transfer", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    const s = {
      role: "owner",
      server: "https://whiteboard-abc.puter.work",
      settings: {
        visibility: "private",
        orgRole: "editor",
        linkRole: "viewer",
      },
      request: async (op) =>
        op === "members"
          ? {
              members: [
                { uuid: "m1", username: "Bea", role: "editor" },
                {
                  uuid: "m2",
                  username: "Gone",
                  role: "editor",
                  inactive: true,
                },
              ],
            }
          : op === "settings.get"
            ? { settings: {} }
            : {},
      // An administrator keeps owner rights after giving the board away.
      heartbeat: async () => {},
    };
    let d;
    const access = createBoardAccess({
      org: { info: null, policy: () => null, allows: () => true },
      session: () => s,
      board: () => ({ items: [] }),
      modal: (title, html, ready) => {
        d = document.createElement("dialog");
        d.close = () => d.remove();
        d.innerHTML = html;
        document.body.append(d);
        ready(d);
        return d;
      },
      toast() {},
      icon: () => "",
    });
    await access.settings();
    // Deactivated members cannot receive a board.
    assert.deepEqual(
      [...d.querySelectorAll("#bs-transfer option")].map((o) => o.value),
      ["", "m1"],
    );
    const status = () => d.querySelector("#bs-status").textContent;
    d.querySelector("#bs-delete").click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(status(), "Select again to delete for everyone");
    d.querySelector("#bs-transfer").value = "m1";
    d.querySelector("#bs-transfer-go").click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(status(), "Ownership transferred.");
    assert.ok(d.querySelector("#bs-archive"), "Owner controls remain");
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("board settings do not open for a board left while they load", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    const board = (room) => {
      let release;
      const loaded = new Promise((r) => (release = r));
      return {
        room,
        role: "owner",
        closed: false,
        server: "https://whiteboard-abc.puter.work",
        settings: { visibility: "private", orgRole: "editor" },
        release,
        request: async (op) => {
          await loaded;
          return op === "members" ? { members: [] } : { settings: {} };
        },
      };
    };
    let current = board("a");
    const opened = [];
    const access = createBoardAccess({
      org: { info: null, policy: () => null, allows: () => true },
      session: () => current,
      board: () => ({ items: [] }),
      modal: (title) => opened.push(title),
      toast() {},
      icon: () => "",
    });
    // Moved on to another board before the settings loaded.
    const first = current;
    const pending = access.settings();
    current = board("b");
    first.closed = true;
    first.release();
    await pending;
    assert.deepEqual(opened, []);
    // Closed without another board opening in its place.
    const second = current;
    const again = access.settings();
    second.closed = true;
    second.release();
    await again;
    assert.deepEqual(opened, []);
    // Still on the same board: the dialog opens as before.
    current = board("c");
    const ready = access.settings();
    current.release();
    await ready;
    assert.deepEqual(opened, ["Board settings"]);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("board settings drop owner controls once ownership is transferred", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    const s = {
      role: "owner",
      server: "https://whiteboard-abc.puter.work",
      settings: {
        visibility: "private",
        orgRole: "editor",
        linkRole: "viewer",
      },
      request: async (op) =>
        op === "members"
          ? { members: [{ uuid: "u2", username: "bob", role: "editor" }] }
          : op === "settings.get"
            ? { settings: {} }
            : {},
      heartbeat: async () => {
        s.role = "facilitator";
      },
    };
    let d;
    const access = createBoardAccess({
      org: { info: null, policy: () => null, allows: () => true },
      session: () => s,
      board: () => ({ items: [] }),
      modal: (title, html, ready) => {
        d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready(d);
        return d;
      },
      toast() {},
      icon: () => "",
    });
    await access.settings();
    d.querySelector("#bs-transfer").value = "u2";
    d.querySelector("#bs-transfer-go").click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      d.querySelector("#bs-transfer, #bs-archive, #bs-delete"),
      null,
    );
    assert.equal(
      d.querySelector("#bs-status").textContent,
      "Ownership transferred. You are now a facilitator.",
    );
    assert.equal(document.activeElement.textContent, "Save settings");
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("guest invitations follow the policy of the board's own server", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    let server = "https://whiteboard-abc.puter.work";
    const access = createBoardAccess({
      org: {
        server: "https://whiteboard-abc.puter.work",
        info: { configured: true, role: "member" },
        policy: () => ({ guestAccess: true, externalSharing: "any" }),
        allows: () => true,
      },
      session: () => ({ role: "owner", server }),
      board: () => ({ items: [] }),
      modal() {},
      toast() {},
      icon: () => "",
    });
    assert.match(access.shareControls(), /id="share-guest"/);
    // A board on someone's own server is not shared under this policy.
    server = "https://whiteboard-other.puter.work";
    assert.doesNotMatch(access.shareControls(), /id="share-guest"/);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("a control busy with its action gets keyboard focus back", async () => {
  const dom = new JSDOM(
    "<!doctype html><body><button id='go'>Save</button><input id='next'><dialog><button id='in'>Use</button></dialog></body>",
  );
  const { busy } = await import("../src/accessibility/busy.js");
  const doc = dom.window.document;
  const go = doc.querySelector("#go");
  // Browsers move focus to the page when the focused control is disabled;
  // jsdom does not, and does not blur a disabled control either.
  const drop = (control) => {
    control.disabled = false;
    control.blur();
    control.disabled = true;
  };
  const run = (control, during = () => drop(control)) => {
    control.focus();
    const done = busy(control);
    assert.equal(control.disabled, true);
    during();
    done();
    assert.equal(control.disabled, false);
  };
  run(go, () => {
    drop(go);
    assert.equal(doc.activeElement, doc.body);
  });
  assert.equal(doc.activeElement, go);
  // Focus the action moved on purpose stays where it went.
  run(go, () => doc.querySelector("#next").focus());
  assert.equal(doc.activeElement.id, "next");
  // A control in a dialog that closed is not focused.
  const dialog = doc.querySelector("dialog");
  dialog.setAttribute("open", "");
  const inside = doc.querySelector("#in");
  run(inside, () => {
    drop(inside);
    dialog.removeAttribute("open");
  });
  assert.notEqual(doc.activeElement, inside);
  assert.doesNotThrow(() => busy(null)());
  dom.window.close();
});

test("board settings send where the board is filed only when changed there", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createBoardAccess } =
      await import("../src/organization/board-access.js");
    const sent = [],
      server = "https://whiteboard-abc.puter.work";
    const s = {
      role: "facilitator",
      server,
      settings: {
        visibility: "private",
        orgRole: "editor",
        linkRole: "viewer",
      },
      request: async (op, payload) => {
        if (op === "members") return { members: [] };
        if (op === "settings.get")
          return {
            settings: {
              visibility: "private",
              orgRole: "editor",
              linkRole: "viewer",
              space: "sp1",
              team: "tm1",
            },
          };
        if (op === "settings") {
          sent.push(payload);
          return { settings: {} };
        }
        return {};
      },
    };
    let d;
    const access = createBoardAccess({
      org: {
        info: { configured: true },
        server,
        isMember: true,
        policy: () => ({ publicLinks: true, externalSharing: "anyone" }),
        allows: () => false,
        request: async (op) =>
          op === "spaces.list"
            ? {
                spaces: [
                  { id: "sp1", name: "One" },
                  { id: "sp2", name: "Two" },
                ],
              }
            : { teams: [{ id: "tm1", name: "T" }] },
      },
      session: () => s,
      board: () => ({ items: [] }),
      modal: (title, html, ready) => {
        d = document.createElement("dialog");
        d.innerHTML = html;
        document.body.append(d);
        ready(d);
        return d;
      },
      toast() {},
      icon: () => "",
    });
    await access.settings();
    const save = async () => {
      d.querySelector("#board-settings").dispatchEvent(
        new dom.window.Event("submit", { cancelable: true }),
      );
      await new Promise((r) => setTimeout(r, 20));
    };
    // Someone else may refile the board meanwhile; changing only its
    // visibility leaves that alone.
    d.querySelector('[name="bs-visibility"][value="organization"]').checked =
      true;
    await save();
    assert.deepEqual(sent.at(-1), { visibility: "organization" });
    d.querySelector("#bs-space").value = "sp2";
    await save();
    assert.equal(sent.at(-1).space, "sp2");
    assert.equal("team" in sent.at(-1), false);
  } finally {
    for (const key of keys) delete globalThis[key];
  }
});

test("audit and board activity preserve captured title language and escaped JSON while paginating and exporting", async () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const keys = [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "Node",
    "Event",
  ];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const { setLanguage } = await import("../src/i18n.js");
    setLanguage("en");
    const phrase =
      'Choisissez "les étapes" <img id="pwn-audit"> \\ ensemble.\n';
    const mixed = "Start. " + phrase + "End.";
    const first = {
      id: "first",
      at: 1,
      category: "content",
      action: "vote.started",
      target: { id: "r1" },
      details: {
        id: "v1",
        title: phrase,
        titleLang: "fr-CA",
        anonymous: false,
      },
    };
    const second = {
      id: "second",
      at: 2,
      category: "content",
      action: "poll.started",
      target: { id: "r1" },
      details: {
        id: "p1",
        title: mixed,
        titleLang: "en-CA",
        titleRuns: [
          { start: 7, end: 7 + phrase.length, style: { lang: "fr-CA" } },
        ],
        anonymous: true,
      },
    };
    const legacy = {
      id: "legacy",
      at: 3,
      category: "content",
      action: "vote.started",
      details: { id: "old", title: "Ancien choix", anonymous: false },
    };
    const invalid = {
      id: "invalid",
      at: 4,
      category: "content",
      action: "vote.started",
      details: {
        id: "bad",
        title: "Broken",
        titleLang: "bad tag",
        titleRuns: [{ start: 1, end: 1000, style: { lang: "fr" } }],
      },
    };
    const downloads = [];
    const admin = createAdminConsole({
      org: {
        isAdmin: true,
        server: "https://whiteboard.test",
        request: async (op, data) =>
          op === "org.audit"
            ? data?.cursor
              ? { entries: [second, legacy, invalid], cursor: null }
              : { entries: [first], cursor: "next" }
            : op === "org.board.activity"
              ? { entries: [second] }
              : op === "org.boards"
                ? {
                    boards: [{ room: "r1", title: "Test", created: 1 }],
                    total: 1,
                  }
                : op === "teams.list"
                  ? { teams: [] }
                  : op === "spaces.list"
                    ? { spaces: [] }
                    : {},
      },
      modal(title, html, ready) {
        const d = document.createElement("dialog");
        d.setAttribute("aria-label", title);
        d.innerHTML = html;
        document.body.append(d);
        ready?.(d);
        return d;
      },
      toast() {},
      icon() {
        return "";
      },
      download(...args) {
        downloads.push(args);
      },
    });
    const d = admin.open("audit");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    await settle();
    let details = d.querySelector(".admin-table tbody tr td:last-child");
    assert.equal(details.textContent, JSON.stringify(first.details));
    assert.equal(
      details.querySelector('[lang="fr-CA"]').textContent,
      JSON.stringify(phrase).slice(1, -1),
    );
    assert.equal(d.querySelector("#pwn-audit"), null);
    d.querySelector("#au-more").focus();
    d.querySelector("#au-more").click();
    await settle();
    const rows = [...d.querySelectorAll(".admin-table tbody tr")];
    assert.equal(rows.length, 4);
    details = rows[1].lastElementChild;
    assert.equal(details.textContent, JSON.stringify(second.details));
    assert.equal(
      details.querySelector('[lang="en-CA"] [lang="fr-CA"]').textContent,
      JSON.stringify(phrase).slice(1, -1),
    );
    assert.equal(rows[2].lastElementChild.querySelector("[lang]"), null);
    assert.equal(rows[3].lastElementChild.querySelector("[lang]"), null);
    assert.equal(
      rows[3].lastElementChild.textContent,
      JSON.stringify(invalid.details),
    );
    assert.equal(document.activeElement.id, "admin-panel");
    d.querySelector("#au-json").click();
    await settle();
    assert.deepEqual(JSON.parse(downloads.at(-1)[0]), [
      first,
      second,
      legacy,
      invalid,
    ]);
    d.querySelector("#au-csv").click();
    await settle();
    assert.match(downloads.at(-1)[0], /fr-CA/);
    dom.window.eval(axe.source);
    const result = await dom.window.axe.run(d, {
      rules: { "color-contrast": { enabled: false } },
    });
    assert.deepEqual(
      Array.from(result.violations, (v) => v.id),
      [],
    );
    setLanguage("fr");
    d.querySelector('[data-tab="boards"]').click();
    await settle();
    d.querySelector('[data-activity="r1"]').click();
    await settle();
    const activity = d.querySelector("#board-detail #audit-table");
    assert.equal(activity.tabIndex, 0);
    assert.equal(activity.getAttribute("aria-label"), "Activité du tableau");
    activity.focus();
    assert.equal(document.activeElement, activity);
    Object.defineProperties(activity, {
      clientWidth: { value: 200 },
      scrollWidth: { value: 500 },
    });
    activity.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.ok(activity.scrollLeft > 0);
    details = d.querySelector(
      "#board-detail .admin-table tbody tr td:last-child",
    );
    assert.equal(details.textContent, JSON.stringify(second.details));
    assert.equal(
      details.querySelector('[lang="en-CA"] [lang="fr-CA"]').textContent,
      JSON.stringify(phrase).slice(1, -1),
    );
  } finally {
    const { setLanguage } = await import("../src/i18n.js");
    setLanguage("en");
    for (const key of keys) delete globalThis[key];
    dom.window.close();
  }
});

test("French authored feedback retains its language through the real worker and admin report", async () => {
  const { environment, owner } = await import("./collaboration-helpers.js");
  const { adminCall } = await import("../worker/admin.js");
  const env = environment(),
    org = env.service.org;
  await adminCall(org, env.service, owner, {
    op: "org.setup",
    name: "Feedback audit",
  });
  const dom = new JSDOM('<!doctype html><html lang="fr"><body></body></html>', {
    url: "https://whiteboard.test",
  });
  const keys = [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "Node",
    "Event",
  ];
  for (const key of keys) globalThis[key] = dom.window[key];
  try {
    const { createHelpCenter } = await import("../src/help/help-center.js");
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const { setLanguage, translateUI } = await import("../src/i18n.js");
    setLanguage("fr");
    const modal = (title, html, ready) => {
      const d = document.createElement("dialog");
      d.setAttribute("aria-label", title);
      d.innerHTML = html;
      document.body.append(d);
      ready?.(d);
      return d;
    };
    let request;
    createHelpCenter({
      modal,
      icon: () => "",
      tour() {},
      shortcuts() {},
      refresh: () => translateUI(),
      org: {
        info: { role: "owner" },
        async request(op, data) {
          request = { op, ...data };
          return adminCall(org, env.service, owner, request);
        },
      },
    }).open();
    const sentence = "Veuillez faciliter la navigation entre les tableaux.";
    document.querySelector("#help-comment").value = sentence;
    document.querySelector('[name="help-ease"][value="4"]').checked = true;
    document
      .querySelector("#help-feedback")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    for (let i = 0; i < 50 && document.querySelector("#help-feedback"); i++)
      await new Promise((r) => setTimeout(r, 2));
    assert.equal(document.querySelector("#help-feedback"), null);
    const records = [...env.data]
      .filter(([key]) => key.startsWith("org:feedback:"))
      .map(([, value]) => value);
    assert.equal(records[0].comment, sentence);
    const report = await adminCall(org, env.service, owner, {
      op: "org.reports",
      days: 30,
    });
    assert.equal(report.feedback.recent[0].comment, sentence);
    const legacy = "Un ancien commentaire sans langue connue.";
    await adminCall(org, env.service, owner, {
      op: "feedback.submit",
      ease: 3,
      comment: legacy,
    });
    setLanguage("en");
    const admin = createAdminConsole({
      org: {
        isAdmin: true,
        server: "https://whiteboard.test",
        request: async (op, data) =>
          adminCall(org, env.service, owner, { op, ...data }),
      },
      modal,
      toast() {},
      icon: () => "",
      download() {},
      refresh: () => translateUI(),
    });
    const d = admin.open();
    for (let i = 0; i < 50 && !d.querySelector(".feedback-comments"); i++)
      await new Promise((r) => setTimeout(r, 2));
    const feedback = d.querySelector(
      '.feedback-comments li [data-user-content][lang="fr"]',
    );
    assert.equal(request.lang, "fr");
    assert.equal(records[0].lang, "fr");
    assert.equal(report.feedback.recent[0].lang, "fr");
    assert.equal(records[0].uuid, undefined);
    assert.equal(report.feedback.recent[0].uuid, undefined);
    assert.equal(feedback.closest("[lang]")?.getAttribute("lang"), "fr");
    const old = [
      ...d.querySelectorAll(".feedback-comments [data-user-content]"),
    ].find((node) => node.textContent === legacy);
    assert.ok(old);
    assert.equal(old.hasAttribute("lang"), false);
    assert.equal(old.querySelector("[lang]"), null);
  } finally {
    const { setLanguage } = await import("../src/i18n.js");
    setLanguage("en");
    for (const key of keys) delete globalThis[key];
    dom.window.close();
  }
});
