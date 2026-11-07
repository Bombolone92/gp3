import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { createOrganizationLibrary } from "../src/organization/library-ui.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";
import { board } from "../src/model.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner, editor, viewer } from "./collaboration-helpers.js";

async function organization() {
  const env = environment(),
    org = env.service.org;
  const call = (input, user = owner) =>
    adminCall(org, env.service, user, input);
  await call({ op: "org.setup", name: "Local library audit" });
  return { env, org, call };
}
function ui(request) {
  const dom = new JSDOM(
    '<!doctype html><html lang="en"><body><button id="opener">Library</button></body></html>',
    {
      url: "https://whiteboard.test",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const keys = [
    "document",
    "localStorage",
    "NodeFilter",
    "HTMLElement",
    "Event",
    "Node",
    "CSS",
  ];
  const previous = Object.fromEntries(
      keys.map((key) => [key, globalThis[key]]),
    ),
    oldLanguage = language;
  for (const key of keys) globalThis[key] = dom.window[key];
  globalThis.CSS ??= { escape: (value) => value };
  const doc = dom.window.document,
    toasts = [],
    opener = doc.querySelector("#opener");
  const library = createOrganizationLibrary({
    org: { isAdmin: true, request },
    modal: (title, html, ready) => {
      const d = doc.createElement("dialog");
      d.setAttribute("aria-label", title);
      d.setAttribute("open", "");
      d.innerHTML = html;
      d.close = () => {
        d.dispatchEvent(new dom.window.Event("close"));
        d.remove();
        opener.focus();
      };
      doc.body.append(d);
      ready(d);
      translateUI(d);
      return d;
    },
    toast: (message) => toasts.push(message),
    icon: () => "",
    shareable: () => board("Local template"),
    useBoard: () => {},
  });
  return {
    dom,
    doc,
    library,
    toasts,
    close() {
      doc.querySelectorAll("dialog").forEach((d) => d.close());
      setLanguage(oldLanguage);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      dom.window.close();
    },
  };
}
async function until(condition) {
  const deadline = Date.now() + 3000;
  while (!condition() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(condition(), "operation completed");
}
function declare(doc, field, tag, start = 0, end = 0) {
  field.setSelectionRange(start, end);
  doc.querySelector("#org-library-description-language-options").click();
  doc.querySelector("#org-library-description-language-tag").value = tag;
  doc.querySelector("#org-library-description-language-save").click();
}
function submit(doc) {
  doc
    .querySelector("form")
    .dispatchEvent(new doc.defaultView.Event("submit", { cancelable: true }));
}

test("library description declarations survive the actual share form, worker, storage, search and reader language", async () => {
  const { call, org } = await organization();
  const requests = [];
  let submitted;
  const fixture = ui(async (op, input = {}) => {
    requests.push({ op, ...structuredClone(input) });
    const result = await call({ op, ...input });
    if (op === "library.submit") submitted = result.item;
    return result;
  });
  const { doc, library } = fixture;
  try {
    setLanguage("fr");
    library.share();
    const field = doc.querySelector("#org-library-description");
    const name = doc.querySelector("#org-library-name");
    assert.equal(name.selectionStart, 0);
    assert.equal(name.selectionEnd, name.value.length);
    assert.equal(doc.querySelector("#org-library-name").required, true);
    assert.equal(
      field.getAttribute("aria-labelledby"),
      "org-library-description-label",
    );
    assert.equal(
      doc.querySelector("#org-library-description-label").textContent,
      "Description (facultative)",
    );
    assert.equal(field.lang, "fr");
    const text =
      'Start. Veuillez choisir les prochaines étapes. <img id="pwn"> End.';
    field.value = "  " + text + "  ";
    declare(doc, field, "en-ca");
    const start = text.indexOf("Veuillez"),
      end = text.indexOf(" <img");
    declare(doc, field, "fr-ca", start + 2, end + 2);
    assert.equal(field.lang, "en-CA");
    const action = doc.querySelector(
      "#org-library-description-language-options",
    );
    assert.equal(
      action.closest("[lang]"),
      doc.documentElement,
      "translated control stays outside authored language",
    );
    assert.match(action.textContent, /Langue du contenu/);
    assert.equal(doc.querySelector("#pwn"), null);
    submit(doc);
    await until(() => submitted);
    const saved = await org.kv.get("org:lib:" + submitted.id);
    assert.equal(saved.description, text);
    assert.equal(saved.descriptionLang, "en-CA");
    assert.deepEqual(saved.descriptionRuns, [
      { start, end, style: { lang: "fr-CA" } },
    ]);
    assert.deepEqual(
      requests.find((r) => r.op === "library.submit").descriptionRuns,
      saved.descriptionRuns,
    );
    assert.equal(doc.querySelector("dialog"), null);
    assert.equal(doc.activeElement.id, "opener");
    setLanguage("en");
    library.open();
    await until(() =>
      doc.querySelector("[data-item] small[data-user-content]"),
    );
    const rendered = doc.querySelector("[data-item] small[data-user-content]");
    assert.equal(rendered.textContent, text);
    assert.equal(rendered.querySelector('[lang="en-CA"]').textContent, text);
    assert.equal(
      rendered.querySelector('[lang="fr-CA"]').textContent,
      text.slice(start, end),
    );
    assert.equal(doc.querySelector("#pwn"), null);
    assert.match(doc.querySelector("[data-item]").textContent, /Shared by/);
    const search = doc.querySelector("#org-library-search");
    search.value = "prochaines";
    search.dispatchEvent(new doc.defaultView.Event("input"));
    assert.equal(doc.querySelectorAll("[data-item]").length, 1);
    assert.equal(
      doc.querySelector('[lang="fr-CA"]').textContent,
      text.slice(start, end),
    );
    const got = await call({ op: "library.get", id: saved.id });
    assert.deepEqual(got.item.descriptionRuns, saved.descriptionRuns);
  } finally {
    fixture.close();
  }
});

test("library share keeps a failed authored draft, sends a snapshot once, restores focus and cleans up on close", async () => {
  const requests = [];
  let reject, resolve;
  const fixture = ui(async (op, input) => {
    assert.equal(op, "library.submit");
    requests.push(structuredClone(input));
    return new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
  });
  const { doc, library, toasts } = fixture;
  try {
    setLanguage("en");
    library.share();
    const form = doc.querySelector("form"),
      name = doc.querySelector("#org-library-name"),
      field = doc.querySelector("#org-library-description");
    name.value = "";
    form.requestSubmit();
    assert.equal(requests.length, 0);
    name.value = "Template";
    field.value = "Begin. Bonjour à tous. End.";
    declare(doc, field, "fr-CA", 7, 21);
    const before = structuredClone(field.textRuns),
      button = form.querySelector(".primary");
    let destroyed = 0;
    const destroy = field.destroy;
    field.destroy = () => {
      destroyed++;
      destroy();
    };
    button.focus();
    submit(doc);
    submit(doc);
    assert.equal(requests.length, 1);
    assert.equal(button.disabled, true);
    field.value += " Later.";
    assert.equal(requests[0].description, "Begin. Bonjour à tous. End.");
    assert.deepEqual(requests[0].descriptionRuns, before);
    // Model the native browser moving focus when a focused control is disabled.
    button.blur();
    reject(Error("Try again"));
    await until(() => !button.disabled);
    assert.equal(toasts.at(-1), "Try again");
    assert.equal(doc.activeElement, button);
    assert.equal(destroyed, 0);
    assert.equal(field.value, "Begin. Bonjour à tous. End. Later.");
    assert.deepEqual(field.textRuns, before);
    submit(doc);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].description, field.value);
    resolve({ item: { status: "approved" } });
    await until(() => !doc.querySelector("dialog"));
    assert.ok(destroyed > 0);
    assert.equal(doc.activeElement.id, "opener");
    library.share();
    const cancelled = doc.querySelector("#org-library-description");
    let cancelledCleanup = false;
    const cleanup = cancelled.destroy;
    cancelled.destroy = () => {
      cancelledCleanup = true;
      cleanup();
    };
    doc.querySelector("dialog").close();
    assert.equal(cancelledCleanup, true);
  } finally {
    fixture.close();
  }
});

test("library language controls validate tags, retain passage edits, allow inheritance and remain accessible", async () => {
  const requests = [];
  const fixture = ui(async (op, input) => {
    requests.push(input);
    return { item: { status: "pending" } };
  });
  const { doc, dom, library } = fixture;
  try {
    setLanguage("en");
    library.share();
    const field = doc.querySelector("#org-library-description");
    field.value = "Begin. Bonjour à tous. End.";
    declare(doc, field, "bad tag");
    assert.equal(
      doc
        .querySelector("#org-library-description-language-tag")
        .getAttribute("aria-invalid"),
      "true",
    );
    assert.match(
      doc.querySelector('[role="alert"]').textContent,
      /valid language tag/,
    );
    doc.querySelector("#org-library-description-language-cancel").click();
    assert.equal(field.lang, "en");
    declare(doc, field, "fr-CA", 7, 21);
    field.value = "Earlier. " + field.value;
    field.value += " Later.";
    assert.deepEqual(field.textRuns, [
      { start: 16, end: 30, style: { lang: "fr-CA" } },
    ]);
    declare(doc, field, "");
    assert.equal(field.hasAttribute("lang"), false);
    const action = doc.querySelector(
      "#org-library-description-language-options",
    );
    action.click();
    dom.window.eval(axe.source);
    const scan = await dom.window.axe.run(doc.querySelector("dialog"), {
      rules: { "color-contrast": { enabled: false } },
    });
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          scan.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        ),
      ),
      [],
    );
    doc.querySelector("#org-library-description-language-cancel").click();
    field.value = "a".repeat(499) + "😀";
    assert.equal(
      field.value,
      "a".repeat(499),
      "editor cap does not split a character",
    );
    field.value = "Earlier. Begin. Bonjour à tous. End. Later.";
    declare(doc, field, "fr-CA", 16, 30);
    submit(doc);
    await until(() => !doc.querySelector("dialog"));
    assert.equal(requests[0].descriptionLang, undefined);
    assert.deepEqual(requests[0].descriptionRuns, [
      { start: 16, end: 30, style: { lang: "fr-CA" } },
    ]);
  } finally {
    fixture.close();
  }
});

test("library worker validates language before writes, clips trimmed Unicode ranges and preserves unknown descriptions", async () => {
  const { env, org, call } = await organization();
  const base = {
    op: "library.submit",
    name: "Template",
    board: JSON.stringify(board("Local template")),
  };
  const fileCount = env.files.size;
  for (const metadata of [
    { descriptionLang: "bad tag" },
    { descriptionLang: null },
    { descriptionRuns: [{ start: 0, end: 99, style: { lang: "fr" } }] },
    { descriptionRuns: [{ start: 0, end: 3, style: { bold: true } }] },
    { descriptionRuns: [{ start: 0, end: 3, style: { lang: "bad tag" } }] },
    {
      descriptionRuns: [
        { start: 0, end: 3, style: { lang: "fr" }, extra: true },
      ],
    },
    {
      descriptionRuns: [
        { start: 0, end: 3, style: { lang: "fr" } },
        { start: 2, end: 4, style: { lang: "en" } },
      ],
    },
    { descriptionRuns: "invalid" },
  ]) {
    await assert.rejects(call({ ...base, description: "Hello", ...metadata }), {
      status: 400,
    });
    assert.equal(
      env.files.size,
      fileCount,
      "invalid metadata cannot create an orphan file",
    );
    assert.equal((await org.list("org:lib:")).length, 0);
  }
  await assert.rejects(
    call({
      ...base,
      description: "😀",
      descriptionRuns: [{ start: 1, end: 2, style: { lang: "fr" } }],
    }),
    { status: 400 },
  );
  const raw = "  " + "a".repeat(499) + "😀 suite  ";
  const { item } = await call({
    ...base,
    description: raw,
    descriptionLang: "en-ca",
    descriptionRuns: [
      { start: 497, end: raw.length, style: { lang: "fr-ca" } },
    ],
  });
  assert.equal(item.description, "a".repeat(499));
  assert.equal(item.descriptionLang, "en-CA");
  assert.deepEqual(item.descriptionRuns, [
    { start: 495, end: 499, style: { lang: "fr-CA" } },
  ]);
  const saved = await org.kv.get("org:lib:" + item.id);
  assert.deepEqual(saved.descriptionRuns, item.descriptionRuns);
  const blank = await call({
    ...base,
    description: "   ",
    descriptionLang: "fr",
    descriptionRuns: [{ start: 0, end: 3, style: { lang: "fr" } }],
  });
  assert.equal(blank.item.description, "");
  assert.equal(blank.item.descriptionLang, undefined);
  assert.equal(blank.item.descriptionRuns, undefined);
  const legacy = await call({
    ...base,
    description: "Unknown original language",
  });
  assert.equal(legacy.item.descriptionLang, undefined);
  assert.equal(legacy.item.descriptionRuns, undefined);
});

test("library description metadata follows approval and member visibility without changing template contents", async () => {
  const { org, call } = await organization();
  const { token } = await call({ op: "org.invite", role: "member" });
  for (const user of [editor, viewer])
    await call({ op: "org.join", token }, user);
  const template = JSON.stringify(board("Unchanged template"));
  const { item } = await call(
    {
      op: "library.submit",
      name: "Template",
      description: "Veuillez choisir. Read first.",
      descriptionLang: "fr-CA",
      descriptionRuns: [{ start: 18, end: 29, style: { lang: "en-CA" } }],
      board: template,
    },
    editor,
  );
  assert.equal(item.status, "pending");
  assert.equal((await call({ op: "library.list" }, viewer)).items.length, 0);
  await assert.rejects(call({ op: "library.get", id: item.id }, viewer), {
    status: 403,
  });
  assert.deepEqual(
    (await call({ op: "library.list" }, editor)).items[0].descriptionRuns,
    item.descriptionRuns,
  );
  await call({ op: "library.approve", id: item.id });
  const listed = (await call({ op: "library.list" }, viewer)).items[0];
  assert.equal(listed.descriptionLang, "fr-CA");
  assert.deepEqual(listed.descriptionRuns, item.descriptionRuns);
  const got = await call({ op: "library.get", id: item.id }, viewer);
  assert.equal(got.board, template);
  assert.equal(got.item.descriptionLang, "fr-CA");
  assert.equal((await org.kv.get("org:lib:" + item.id)).status, "approved");
});

test("old untagged library descriptions stay literal and do not acquire the reader's language", async () => {
  const fixture = ui(async () => ({
    items: [
      {
        id: "old",
        name: "Old template",
        category: "General",
        status: "approved",
        description: 'Veuillez continuer. <img id="pwn">',
      },
    ],
  }));
  const { doc, library } = fixture;
  try {
    setLanguage("en");
    library.open();
    await until(() => doc.querySelector("small[data-user-content]"));
    const content = doc.querySelector("small[data-user-content]");
    assert.equal(content.textContent, 'Veuillez continuer. <img id="pwn">');
    assert.equal(content.querySelector("[lang]"), null);
    assert.equal(doc.querySelector("#pwn"), null);
    setLanguage("fr");
    translateUI(doc.querySelector("dialog"));
    assert.equal(content.querySelector("[lang]"), null);
    assert.equal(content.textContent, 'Veuillez continuer. <img id="pwn">');
  } finally {
    fixture.close();
  }
});
