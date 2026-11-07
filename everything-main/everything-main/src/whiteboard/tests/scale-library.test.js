import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { scaleData } from "../scripts/generate-scale-data.mjs";
import { scaleOrganization } from "../scripts/scale-organization.js";

async function withLibrary(verify, override = () => {}) {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: "https://whiteboard.test",
    pretendToBeVisual: true,
  });
  const keys = ["document", "localStorage", "NodeFilter", "HTMLElement", "CSS"];
  for (const key of keys) globalThis[key] = dom.window[key];
  globalThis.CSS = { escape: (s) => s };
  const { createOrganizationLibrary } =
    await import("../src/organization/library-ui.js");
  const { setLanguage } = await import("../src/i18n.js");
  const sample = scaleData(),
    org = scaleOrganization(sample),
    calls = [],
    used = [];
  const request = org.request.bind(org);
  org.request = async (op, input) => {
    calls.push({ op, input });
    return (await override(op, input, sample)) ?? request(op, input);
  };
  let d;
  const library = createOrganizationLibrary({
    org,
    modal(title, html, ready) {
      d = document.createElement("dialog");
      d.innerHTML = html;
      document.body.append(d);
      d.close = () => d.remove();
      ready?.(d);
      return d;
    },
    toast() {},
    icon: () => "",
    useBoard: async (...args) => used.push(args),
  });
  const settle = () => new Promise((r) => setTimeout(r, 10));
  try {
    setLanguage("en");
    library.open();
    await settle();
    await verify({
      d,
      sample,
      calls,
      used,
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

test("500-template library bounds rendered actions and reaches every template without refetching", async () => {
  await withLibrary(async ({ d, sample, calls }) => {
    assert.equal(d.querySelectorAll("[data-item]").length, 50);
    assert.ok(d.querySelectorAll("#org-library-list button").length <= 150);
    const seen = new Set();
    for (let n = 0; n < 10; n++) {
      for (const row of d.querySelectorAll("[data-item]"))
        seen.add(row.dataset.item);
      if (n < 9) d.querySelector("#org-library-next").click();
    }
    assert.deepEqual(seen, new Set(sample.library.map((i) => i.id)));
    assert.equal(calls.filter((c) => c.op === "library.list").length, 1);
  });
});

test("library search reaches unseen templates, retains description language, and uses the correct saved board", async () => {
  await withLibrary(async ({ d, sample, window, used, settle }) => {
    const search = d.querySelector("#org-library-search");
    search.value = "Workshop template 500";
    search.dispatchEvent(new window.Event("input"));
    assert.equal(d.querySelectorAll("[data-item]").length, 1);
    assert.equal(
      d.querySelector("[data-item]").dataset.item,
      sample.library[499].id,
    );
    assert.equal(
      d.querySelector('small [lang="fr-CA"]').textContent,
      sample.library[499].description,
    );
    // The shared date is one piece in an item's details; it never wraps.
    assert.ok(d.querySelector(".revision-row small .nowrap"));
    d.querySelector("[data-library-use]").click();
    await settle();
    assert.equal(used[0][1], sample.library[499].name);
    assert.equal(JSON.parse(used[0][0]).items.length, 10);
    assert.equal(d.isConnected, false);
  });
});

test("library paging keeps boundary focus and approving during search preserves the new view and focus", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  await withLibrary(
    async ({ d, window, settle, setLanguage, calls }) => {
      const next = d.querySelector("#org-library-next"),
        previous = d.querySelector("#org-library-prev");
      next.focus();
      for (let n = 0; n < 9; n++) next.click();
      assert.equal(document.activeElement, previous);
      for (let n = 0; n < 9; n++) previous.click();
      assert.equal(document.activeElement, next);
      const approve = d.querySelector("[data-library-approve]");
      const item = approve.closest("[data-item]").dataset.item;
      approve.focus();
      approve.click();
      next.click();
      previous.click();
      assert.ok(
        [
          ...d
            .querySelector(`[data-item="${item}"]`)
            .querySelectorAll("button"),
        ].every((b) => b.disabled),
      );
      const search = d.querySelector("#org-library-search");
      search.focus();
      search.value = "Workshop template 500";
      search.dispatchEvent(new window.Event("input"));
      resolve({});
      await settle();
      assert.equal(document.activeElement, search);
      assert.equal(d.querySelectorAll("[data-item]").length, 1);
      assert.equal(
        d.querySelector("[data-item]").dataset.item,
        "sample-template-499",
      );
      assert.equal(calls.filter((c) => c.op === "library.approve").length, 1);
      setLanguage("fr");
      search.value = "";
      search.dispatchEvent(new window.Event("input"));
      assert.equal(
        d.querySelector("#org-library-status").textContent,
        "Éléments 1–50 sur 500.",
      );
    },
    (op) => (op === "library.approve" ? pending : undefined),
  );
});

test("library approvals retain a different row's keyboard focus and failures re-enable revisited actions", async () => {
  let resolve, reject;
  const pending = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let attempt = 0;
  await withLibrary(
    async ({ d, settle }) => {
      const first = d.querySelector("[data-library-approve]");
      first.focus();
      first.click();
      const other = d.querySelectorAll("[data-library-use]")[1];
      const otherId = other.closest("[data-item]").dataset.item;
      other.focus();
      resolve({});
      await settle();
      assert.equal(
        document.activeElement.closest("[data-item]").dataset.item,
        otherId,
      );
      const failed = d.querySelector("[data-library-approve]");
      const failedId = failed.closest("[data-item]").dataset.item;
      failed.focus();
      failed.click();
      await settle();
      assert.equal(
        d.querySelector("#org-library-error").textContent,
        "Sample approval failure",
      );
      assert.equal(
        d.querySelector(`[data-item="${failedId}"] [data-library-approve]`)
          .disabled,
        false,
      );
    },
    (op) => {
      if (op !== "library.approve") return;
      if (attempt++ === 0) return pending;
      throw Error("Sample approval failure");
    },
  );
});

test("removing the only item on a last library page clamps the page and keeps all other templates reachable", async () => {
  await withLibrary(
    async ({ d, settle, sample }) => {
      const next = d.querySelector("#org-library-next");
      for (let n = 0; n < 10; n++) next.click();
      assert.equal(d.querySelectorAll("[data-item]").length, 1);
      const remove = d.querySelector("[data-library-remove]");
      remove.focus();
      remove.click();
      remove.click();
      await settle();
      assert.equal(d.querySelectorAll("[data-item]").length, 50);
      assert.equal(
        d.querySelector("#org-library-status").textContent,
        "Showing library items 451–500 of 500.",
      );
      assert.equal(document.activeElement.id, "org-library-search");
      assert.equal(d.querySelector("#org-library-next").disabled, true);
    },
    (op, input, sample) => {
      if (op === "library.list")
        return {
          canPublish: true,
          items: [
            ...sample.library,
            { ...sample.library[499], id: "extra-template", created: 1 },
          ],
        };
      if (op === "library.remove") return {};
    },
  );
});
