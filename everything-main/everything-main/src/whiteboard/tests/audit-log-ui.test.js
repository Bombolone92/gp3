import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { adminCall } from "../worker/admin.js";
import { DAY } from "../worker/org.js";
import { environment, owner } from "./collaboration-helpers.js";

async function withConsole(request, verify, lang = "en", includeRange = true) {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
    pretendToBeVisual: true,
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement"];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { setLanguage } = await import("../src/i18n.js");
  try {
    setLanguage(lang);
    const { createAdminConsole } =
      await import("../src/organization/admin-ui.js");
    const downloads = [];
    const admin = createAdminConsole({
      org: {
        isAdmin: true,
        async request(op, data) {
          const response = await request(op, data);
          if (response.range || op !== "org.audit" || !includeRange)
            return response;
          const now = Date.now();
          const to = data.to ? Date.parse(data.to) : now;
          return {
            ...response,
            range: {
              from: data.from
                ? Date.parse(data.from)
                : Math.min(to, Date.now()) - 30 * DAY,
              to,
              now,
            },
          };
        },
      },
      modal(title, html, ready) {
        const dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        dialog.setAttribute("open", "");
        document.body.append(dialog);
        ready?.(dialog);
        return dialog;
      },
      icon: () => "",
      toast() {},
      download: (...args) => downloads.push(args),
    });
    const dialog = admin.open("audit");
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
    await verify({ dialog, downloads, settle, window: dom.window });
  } finally {
    setLanguage("en");
    dom.window.close();
    for (const key of keys) delete globalThis[key];
  }
}

test("audit export pins its date range so time passing between pages cannot omit events", async () => {
  const env = environment();
  env.now = Date.parse("2026-10-06T12:00:00Z");
  const org = env.service.org;
  for (let n = 0; n < 201; n++) {
    const at = n === 0 ? env.now - 30 * DAY + 1 : env.now - n;
    const time = new Date(at).toISOString();
    const id = `${time}:event-${n}`;
    await org.kv.set("org:audit:" + id, {
      id,
      at,
      time,
      action: "audit.test",
      category: "admin",
      details: {},
    });
  }
  const dateNow = Date.now;
  Date.now = () => env.now;
  try {
    await withConsole(
      async (op, data) => {
        assert.equal(op, "org.audit");
        if (data.cursor) env.now += 1000;
        return adminCall(org, env.service, owner, { op, ...data });
      },
      async ({ dialog, downloads, settle }) => {
        assert.equal(dialog.querySelectorAll("tbody tr").length, 200);
        dialog.querySelector("#au-json").click();
        await settle();
        assert.equal(downloads.length, 1);
        assert.equal(JSON.parse(downloads[0][0]).length, 201);
        dialog.querySelector("#au-more").click();
        await settle();
        assert.equal(dialog.querySelectorAll("tbody tr").length, 201);
      },
    );
  } finally {
    Date.now = dateNow;
  }
});

test("a reversed audit date range keeps the editable form and previous results until corrected", async () => {
  let calls = 0;
  await withConsole(
    async (op) => {
      // Audit queries only; the people to filter by are read once.
      if (op === "org.audit") calls++;
      return {
        entries: [{ id: "a", at: 1, action: "board.created", details: {} }],
        cursor: null,
      };
    },
    async ({ dialog, window, settle }) => {
      const form = dialog.querySelector("#audit-filters");
      const from = form.querySelector("#au-from");
      const to = form.querySelector("#au-to");
      from.value = "2026-09-20";
      to.value = "2026-09-19";
      to.dispatchEvent(new window.Event("input", { bubbles: true }));
      form.dispatchEvent(new window.Event("submit", { cancelable: true }));
      await settle();
      assert.equal(calls, 1);
      assert.equal(dialog.querySelector("#audit-filters"), form);
      assert.equal(dialog.querySelectorAll("tbody tr").length, 1);
      assert.equal(to.validity.customError, true);
      assert.match(to.validationMessage, /end date/i);
      to.value = "2026-09-20";
      to.dispatchEvent(new window.Event("input", { bubbles: true }));
      assert.equal(to.validity.valid, true);
      form.dispatchEvent(new window.Event("submit", { cancelable: true }));
      await settle();
      assert.equal(calls, 2);
    },
  );
});

test("audit results disclose the effective default and filtered date ranges in both interface languages", async () => {
  for (const lang of ["en", "fr"]) {
    const queries = [];
    await withConsole(
      async (op, query) => {
        const to = query.to ? Date.parse(query.to) : Date.now();
        const range = {
          from: query.from
            ? Date.parse(query.from)
            : Math.min(to, Date.now()) - 30 * DAY,
          to,
        };
        queries.push({
          from: new Date(range.from).toISOString(),
          to: new Date(range.to).toISOString(),
        });
        return { entries: [], cursor: null, range };
      },
      async ({ dialog, window, settle }) => {
        const verifyRange = () => {
          const query = queries.at(-1);
          const hint = dialog.querySelector("#audit-range");
          assert.ok(
            hint,
            "blank date filters must disclose the effective 30-day range",
          );
          for (const bound of [query.from, query.to]) {
            assert.ok(
              hint.textContent.includes(
                new Date(bound).toLocaleString(
                  lang === "fr" ? "fr-CA" : "en-CA",
                ),
              ),
            );
          }
          assert.equal(
            dialog
              .querySelector("#audit-table")
              .getAttribute("aria-describedby"),
            hint.id,
          );
          assert.match(
            hint.textContent,
            lang === "fr" ? /^Événements du / : /^Showing events from /,
          );
        };
        verifyRange();
        dialog.querySelector("#au-from").value = "2026-09-01";
        dialog.querySelector("#au-to").value = "2026-09-03";
        dialog
          .querySelector("#audit-filters")
          .dispatchEvent(new window.Event("submit", { cancelable: true }));
        await settle();
        verifyRange();
      },
      lang,
    );
  }
});

test("default audit queries and exports use the worker clock when the device clock is wrong", async () => {
  const env = environment();
  env.now = Date.parse("2026-10-06T12:00:00Z");
  const org = env.service.org;
  const entry = await org.audit(owner, "policy.clock-test");
  const originalNow = Date.now;
  Date.now = () => env.now + 366 * DAY;
  try {
    await withConsole(
      (op, data) => adminCall(org, env.service, owner, { op, ...data }),
      async ({ dialog, downloads, settle }) => {
        assert.equal(
          dialog.querySelector(".admin-table code")?.textContent,
          entry.action,
        );
        dialog.querySelector("#au-json").click();
        await settle();
        assert.deepEqual(
          JSON.parse(downloads[0][0]).map((e) => e.id),
          [entry.id],
        );
      },
    );
  } finally {
    Date.now = originalNow;
  }
});

test("workers without query metadata retain their date defaults when the device clock differs", async () => {
  const env = environment();
  env.now = Date.parse("2026-10-06T12:00:00Z");
  const org = env.service.org;
  const entry = await org.audit(owner, "policy.legacy-clock");
  const originalNow = Date.now;
  Date.now = () => env.now + 366 * DAY;
  const queries = [];
  try {
    await withConsole(
      async (op, data) => {
        queries.push(data);
        const { range, ...response } = await adminCall(
          org,
          env.service,
          owner,
          { op, ...data },
        );
        return response;
      },
      async ({ dialog, downloads, settle }) => {
        assert.equal(queries[0].from, undefined);
        assert.equal(queries[0].to, undefined);
        assert.equal(
          dialog.querySelector(".admin-table code")?.textContent,
          entry.action,
        );
        assert.match(
          dialog.querySelector("#audit-range").textContent,
          /30 days/,
        );
        dialog.querySelector("#au-json").click();
        await settle();
        assert.deepEqual(
          JSON.parse(downloads[0][0]).map((e) => e.id),
          [entry.id],
        );
      },
      "en",
      false,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("a future audit start with no end date remains editable until an end date is supplied", async () => {
  const env = environment();
  env.now = Date.parse("2026-10-06T12:00:00Z");
  const org = env.service.org;
  const entry = await org.audit(owner, "policy.future-range");
  let calls = 0;
  await withConsole(
    (op, data) => {
      if (op === "org.audit") calls++;
      return adminCall(org, env.service, owner, { op, ...data });
    },
    async ({ dialog, window, settle }) => {
      const form = dialog.querySelector("#audit-filters");
      const from = form.querySelector("#au-from");
      const to = form.querySelector("#au-to");
      from.value = "2026-10-07";
      from.dispatchEvent(new window.Event("input", { bubbles: true }));
      form.dispatchEvent(new window.Event("submit", { cancelable: true }));
      await settle();
      assert.equal(calls, 1);
      assert.equal(dialog.querySelector("#audit-filters"), form);
      assert.equal(
        dialog.querySelector(".admin-table code")?.textContent,
        entry.action,
      );
      assert.equal(to.validity.customError, true);
      to.value = "2026-10-08";
      to.dispatchEvent(new window.Event("input", { bubbles: true }));
      assert.equal(to.validity.valid, true);
      form.dispatchEvent(new window.Event("submit", { cancelable: true }));
      await settle();
      assert.equal(calls, 2);
      assert.ok(dialog.querySelector("#audit-filters"));
      assert.match(dialog.querySelector("tbody").textContent, /No events/);
    },
  );
});
