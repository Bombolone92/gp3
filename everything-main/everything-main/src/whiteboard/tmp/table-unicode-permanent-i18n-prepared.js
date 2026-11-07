import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("translation follows updated accessible labels and preserves authored text", async () => {
  const dom = new JSDOM(
    '<button aria-label="Open First">New board</button><p data-user-content>New board</p>',
    { url: "https://whiteboard.test" },
  );
  globalThis.document = dom.window.document;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, translateUI } = await import("../src/i18n.js");
  try {
    const button = document.querySelector("button");
    setLanguage("fr");
    translateUI();
    assert.equal(button.textContent, "Nouveau tableau");
    assert.equal(button.getAttribute("aria-label"), "Ouvrir First");
    button.setAttribute("aria-label", "Open Second");
    translateUI();
    assert.equal(button.getAttribute("aria-label"), "Ouvrir Second");
    assert.equal(document.querySelector("p").textContent, "New board");
    setLanguage("en");
    translateUI();
    assert.equal(button.getAttribute("aria-label"), "Open Second");
    assert.equal(button.textContent, "New board");
  } finally {
    dom.window.close();
    delete globalThis.document;
    delete globalThis.NodeFilter;
    delete globalThis.localStorage;
  }
});

test("dates and times shown in the interface follow the app language", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const root = new URL("../src/", import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((f) =>
    f.endsWith(".js"),
  );
  // Formatting without a locale uses the browser's, which may not be the
  // language the interface is shown in.
  const unset = files.filter((f) =>
    /\.toLocale(Date|Time)?String\(\s*\)/.test(
      readFileSync(new URL(f, root), "utf8"),
    ),
  );
  assert.deepEqual(unset, []);
});

test("error messages are shown in the app's language", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const root = new URL("../src/", import.meta.url);
  const shown = readdirSync(root, { recursive: true })
    .filter((f) => f.endsWith(".js"))
    .filter((f) =>
      /textContent\s*=\s*(error|e|err)\.message\b/.test(
        readFileSync(new URL(f, root), "utf8"),
      ),
    );
  assert.deepEqual(shown, []);
});

test("messages the workers show people have French translations", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const read = (dir) =>
    readdirSync(new URL(dir, import.meta.url), { recursive: true })
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(new URL(dir + f, import.meta.url), "utf8"));
  const dictionaries = read("../src/").join("\n");
  // The SCIM and REST APIs answer machines, in English.
  const apiOnly = new Set([
    "A valid API key is required.",
    "This API key is invalid, expired, or revoked.",
  ]);
  const missing = [];
  for (const file of readdirSync(new URL("../worker/", import.meta.url)))
    if (file.endsWith(".js") && file !== "api.js")
      for (const [, message] of readFileSync(
        new URL("../worker/" + file, import.meta.url),
        "utf8",
      ).matchAll(
        /(?:fail\(\s*\d+,\s*(?:[\w.]+\s*\|\|\s*)?|Error\(\s*)"((?:[^"\\]|\\.)*)"/g,
      ))
        if (
          !apiOnly.has(message) &&
          !dictionaries.includes(`${JSON.stringify(message)}:`)
        )
          missing.push(`${file}: ${message}`);
  // The collaboration endpoint's own answers, such as for an unexpected
  // failure, reach people too.
  const index = readFileSync(
    new URL("../worker/index.js", import.meta.url),
    "utf8",
  );
  const start = index.indexOf('router.post("/api"');
  const route = index.slice(start, index.indexOf("router.", start + 1));
  for (const [, message] of route.matchAll(/"([A-Z][^"]* [^"]*\.)"/g))
    if (!dictionaries.includes(`${JSON.stringify(message)}:`))
      missing.push(`index.js: ${message}`);
  assert.deepEqual([...new Set(missing)], []);
});

test("export and organization errors have French translations", async () => {
  const dom = new JSDOM("", { url: "https://whiteboard.test" });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, t } = await import("../src/i18n.js");
  await import("../src/organization/admin-strings.js");
  try {
    setLanguage("fr");
    for (const message of [
      "This export is too large. Export fewer frames at a time.",
      "Join an organization first.",
    ])
      assert.notEqual(t(message), message);
    // An error without a message shows nothing rather than failing.
    assert.equal(t(undefined), undefined);
  } finally {
    setLanguage("en");
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test("errors from sharing and joining a board have French translations", async () => {
  const dom = new JSDOM("", { url: "https://whiteboard.test" });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, t } = await import("../src/i18n.js");
  await import("../src/worker-strings.js");
  const { readFile } = await import("node:fs/promises");
  try {
    setLanguage("fr");
    const messages = [];
    for (const file of ["api.js", "auth.js"]) {
      const source = await readFile(
        new URL(`../src/collaboration/${file}`, import.meta.url),
        "utf8",
      );
      for (const [, message] of source.matchAll(/Error\(\s*"([^"]+)"/g))
        messages.push(message);
    }
    assert.ok(messages.length >= 5);
    for (const message of messages) assert.notEqual(t(message), message);
  } finally {
    setLanguage("en");
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test("text that names a built-in object property is not a translation", async () => {
  const dom = new JSDOM(
    '<select><option>valueOf</option><option>constructor</option></select><button aria-label="hasOwnProperty">toString</button>',
    { url: "https://whiteboard.test" },
  );
  globalThis.document = dom.window.document;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, t, translateUI } = await import("../src/i18n.js");
  try {
    setLanguage("fr");
    for (const word of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "Edit constructor",
    ])
      assert.equal(t(word), word);
    translateUI();
    assert.deepEqual(
      [...document.querySelectorAll("option")].map((o) => o.textContent),
      ["valueOf", "constructor"],
    );
    assert.equal(document.querySelector("button").textContent, "toString");
    assert.equal(t("Done"), "Terminé");
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
    delete globalThis.NodeFilter;
    delete globalThis.localStorage;
  }
});

test("names people give, in options and full-name tooltips, stay as written", async () => {
  const dom = new JSDOM(
    '<select><option>Done</option><option data-user-content>Done</option></select><h3 data-user-content title="Open data">Open data</h3><button title="Open">Open</button><div data-user-content aria-label="Content preview"></div>',
    { url: "https://whiteboard.test" },
  );
  globalThis.document = dom.window.document;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, t, translateUI } = await import("../src/i18n.js");
  try {
    setLanguage("fr");
    translateUI();
    const [ui, named] = document.querySelectorAll("option");
    assert.equal(ui.textContent, t("Done"));
    assert.notEqual(ui.textContent, "Done");
    assert.equal(named.textContent, "Done");
    assert.equal(document.querySelector("h3").title, "Open data");
    assert.equal(document.querySelector("button").title, t("Open"));
    // Labels the app gives user content are still translated.
    assert.equal(
      document.querySelector("div").getAttribute("aria-label"),
      t("Content preview"),
    );
    assert.notEqual(t("Content preview"), "Content preview");
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
    delete globalThis.NodeFilter;
    delete globalThis.localStorage;
  }
});

test("the reason to verify an email reads in the interface language", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  const keys = [
    "document",
    "HTMLElement",
    "Node",
    "NodeFilter",
    "localStorage",
  ];
  for (const key of keys) globalThis[key] = dom.window[key];
  const { setLanguage, translateUI } = await import("../src/i18n.js");
  await import("../src/worker-strings.js");
  const { createOrganizationHome } =
    await import("../src/organization/home-ui.js");
  try {
    setLanguage("fr");
    let dialog;
    const home = createOrganizationHome({
      org: {
        server: "https://org.puter.work",
        info: { role: null },
        onChange() {},
        request: async () => ({}),
      },
      modal: (title, html, ready) => {
        dialog = document.createElement("dialog");
        dialog.innerHTML = html;
        document.body.append(dialog);
        ready?.(dialog);
        translateUI(dialog);
        return dialog;
      },
      toast() {},
      icon: () => "",
      async openShared() {},
    });
    home.verifyDialog(
      "Verify an email address in your organization's domain, or ask an administrator for an invitation.",
    );
    assert.match(
      dialog.querySelector(".dialog-copy").textContent,
      /^Vérifiez une adresse courriel/,
    );
  } finally {
    setLanguage("en");
    dom.window.close();
    for (const key of keys) delete globalThis[key];
  }
});

test("board search names embedded content as a kind of content in French", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, t } = await import("../src/i18n.js");
  await import("../src/content/strings.js");
  const { SEARCH_TYPES } = await import("../src/board-search.js");
  try {
    setLanguage("fr");
    const label = SEARCH_TYPES.find(([type]) => type === "embed")[1];
    assert.equal(t(label), "Contenu intégré");
    // The action keeps its own wording.
    assert.equal(t("Embed"), "Intégrer");
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test("French names data tables apart from boards", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://whiteboard.test",
  });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, t } = await import("../src/i18n.js");
  try {
    setLanguage("fr");
    assert.equal(t("Table"), "Tableau de données");
    assert.equal(t("Tables"), "Tableaux de données");
    assert.equal(t("Boards"), "Tableaux");
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test("audit event categories keep their own French next to shared labels", async () => {
  const dom = new JSDOM("", { url: "https://whiteboard.test" });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, t } = await import("../src/i18n.js");
  await import("../src/libraries.js");
  await import("../src/organization/admin-strings.js");
  try {
    setLanguage("fr");
    assert.equal(t("Board access", "category"), "Accès aux tableaux");
    assert.equal(t("Board access"), "Accès au tableau");
    assert.equal(t("All", "category"), "Toutes");
    assert.equal(t("All"), "Tout");
  } finally {
    setLanguage("en");
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test("counted messages take the singular each language uses", async () => {
  const dom = new JSDOM("", { url: "https://whiteboard.test" });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, plural } = await import("../src/i18n.js");
  await import("../src/history/restore.js");
  const restored = (n) =>
    plural(n, "{count} object restored.", "{count} objects restored.");
  try {
    setLanguage("en");
    assert.deepEqual([0, 1, 2].map(restored), [
      "0 objects restored.",
      "1 object restored.",
      "2 objects restored.",
    ]);
    setLanguage("fr");
    assert.deepEqual([0, 1, 2].map(restored), [
      "0 objet restauré.",
      "1 objet restauré.",
      "2 objets restaurés.",
    ]);
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test("objects are named by kind in words people use, not stored type names", async () => {
  const dom = new JSDOM("", { url: "https://whiteboard.test" });
  globalThis.document = dom.window.document;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.localStorage = dom.window.localStorage;
  const { setLanguage, objectName, editTitle } = await import("../src/i18n.js");
  try {
    setLanguage("en");
    assert.equal(
      objectName({ type: "note", text: "Idea" }),
      "Sticky note: Idea",
    );
    assert.equal(
      objectName({ type: "rect", text: "" }),
      "Rectangle: Untitled object",
    );
    assert.equal(objectName({ type: "pen" }), "Drawing: Untitled object");
    assert.equal(editTitle({ type: "rect" }), "Edit rectangle");
    assert.equal(editTitle({ type: "embed" }), "Edit embedded content");
    setLanguage("fr");
    assert.equal(
      objectName({ type: "note", text: "Idée" }),
      "note adhésive: Idée",
    );
    assert.equal(editTitle({ type: "rect" }), "Modifier : rectangle");
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
    delete globalThis.NodeFilter;
    delete globalThis.localStorage;
  }
});


for(const locale of ['en','fr'])
  test(`table object names keep complete Unicode, translated prefixes and cell languages in ${locale}`,async()=>{
    const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
    const {language,objectName,objectKind,t,setLanguage}=await import('../src/i18n.js'),{objectNameHTML}=await import('../src/accessibility/object-content.js'),previousLanguage=language;
    try {
      setLanguage(locale);
      for(const n of [298,299,300])
        for(const shape of ['single','multiple','empty'])
          for(const locked of [false,true]) {
            const length=shape==='multiple'?n-8:n,cell='Q'.repeat(length)+'😀',cells=shape==='single'?[[cell]]:shape==='multiple'?[['Intro',cell]]:[['',cell]],column=shape==='single'?0:1;
            const node={type:'table',locked,cells,lang:'de',cellLanguages:{['0,'+column]:{lang:'fr-CA',textRuns:[{start:length,end:length+2,style:{lang:'en-GB'}}]}}},original=structuredClone(node);
            const full=cells.flat().filter(Boolean).join(' · ');let expected='';for(const character of full){if(expected.length+character.length>300)break;expected+=character;}
            const prefix=(locked?t('Locked')+' · ':'')+objectKind(node)+': ',name=objectName(node);
            assert.equal(name,prefix+expected);assert.equal(name.isWellFormed(),true);
            const host=dom.window.document.querySelector('main');host.innerHTML=objectNameHTML(node);
            assert.equal(host.textContent,prefix+expected);assert.equal(host.querySelector('[data-user-content]').lang,'de');
            assert.equal(host.querySelector('[lang="en-GB"]')?.textContent,n===298?'😀':undefined);
            assert.ok(host.querySelector('[lang="fr-CA"]'));assert.deepEqual(node,original);
          }
    }finally{setLanguage(previousLanguage);globalThis.document=previous;dom.window.close();}
  });
