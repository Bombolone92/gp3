import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, validateBoard } from "../src/model.js";
import { createAI } from "../src/ai/ai-ui.js";
import { language, setLanguage } from "../src/i18n.js";
for (const locale of ["en", "fr"])
  for (const scenario of [
    "selected remains",
    "selected deleted",
    "selection replaced",
    "selection partly deleted",
    "whole board",
    "whole board then selected",
  ])
    test(`Summary stays within its displayed ${scenario} scope in ${locale}`, async () => {
      const dom = new JSDOM("<body></body>", {
          url: "https://whiteboard.test",
        }),
        descriptors = Object.fromEntries(
          ["document", "localStorage"].map((k) => [
            k,
            Object.getOwnPropertyDescriptor(globalThis, k),
          ]),
        ),
        previousLanguage = language;
      for (const key of ["document", "localStorage"])
        Object.defineProperty(globalThis, key, {
          value: dom.window[key],
          configurable: true,
          writable: true,
        });
      let d;
      try {
        setLanguage(locale);
        const b = board("Chosen summary scope"),
          chosen = item("note", 0, 0, { text: "Chosen short source." }),
          other = item("note", 1, 0, {
            text: "Other visible notes that were not chosen.",
          }),
          hidden = item("note", 2, 0, { text: "Private source." });
        b.items = [chosen, other, hidden];
        validateBoard(structuredClone(b));
        const whole = scenario.startsWith("whole board");
        const selected = new Set(
          whole
            ? []
            : scenario === "selection partly deleted"
              ? [chosen.id, other.id]
              : [chosen.id],
        );
        const prompts = [],
          toasts = [];
        let writes = 0;
        const ai = createAI({
          org: {
            info: { role: "member" },
            allows: () => true,
            request: async (op, data) => {
              prompts.push(data);
              return { text: "Controlled review response." };
            },
          },
          session: () => null,
          board: () => b,
          view: () => ({
            ...b,
            items: b.items.filter((i) => i.id !== hidden.id),
          }),
          selection: () => selected,
          modal(title, html, init) {
            d = dom.window.document.createElement("dialog");
            d.open = true;
            d.innerHTML = html;
            d.close = () => {
              d.open = false;
              d.dispatchEvent(new dom.window.Event("close"));
              d.remove();
            };
            dom.window.document.body.append(d);
            init(d);
            return d;
          },
          icon: () => "",
          mutate(fn) {
            writes++;
            fn();
          },
          center: () => ({ x: 0, y: 0 }),
          select() {},
          canEdit: () => true,
          toast: (m) => toasts.push(m),
          refresh() {},
          puter: () => null,
        });
        ai.open();
        const button = d.querySelector('[data-ai="summarize"]');
        const scope = button.querySelector("small").textContent;
        assert.equal(
          scope,
          whole
            ? locale === "en"
              ? "The whole board"
              : "Le tableau entier"
            : locale === "en"
              ? "The selected objects"
              : "Les objets sélectionnés",
        );
        if (scenario === "selected deleted") {
          b.items = b.items.filter((i) => i.id !== chosen.id);
          selected.clear();
          validateBoard(structuredClone(b));
        }
        if (scenario === "selection replaced") {
          selected.clear();
          selected.add(other.id);
        }
        if (scenario === "whole board then selected") selected.add(chosen.id);
        if (scenario === "selection partly deleted") {
          b.items = b.items.filter((i) => i.id !== chosen.id);
          selected.delete(chosen.id);
        }
        const original = JSON.stringify(b);
        await button.onclick();
        if (scenario === "selected deleted") {
          assert.equal(
            prompts.length,
            0,
            "The selected-object action must not send other board content after its source disappears.",
          );
          assert.equal(d.querySelector("#ai-summary"), null);
          assert.deepEqual(toasts, ["There is no text to summarize."]);
        } else {
          assert.equal(prompts.length, 1);
          assert.equal(
            prompts[0].prompt.includes(other.text),
            whole || scenario === "selection partly deleted",
          );
          assert.equal(
            prompts[0].prompt.includes(chosen.text),
            scenario !== "selection partly deleted",
          );
          assert.equal(prompts[0].prompt.includes(hidden.text), false);
        }
        assert.equal(JSON.stringify(b), original);
        assert.equal(writes, 0);
      } finally {
        d?.close();
        setLanguage(previousLanguage);
        dom.window.close();
        for (const [key, descriptor] of Object.entries(descriptors))
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else delete globalThis[key];
      }
    });

test("a summary includes the board's comments and completed votes and polls this person may see", async () => {
  const dom = new JSDOM("<body></body>", { url: "https://whiteboard.test" }),
    descriptors = Object.fromEntries(
      ["document", "localStorage"].map((k) => [
        k,
        Object.getOwnPropertyDescriptor(globalThis, k),
      ]),
    );
  for (const key of ["document", "localStorage"])
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  let d;
  try {
    const b = board("Retro"),
      shown = item("note", 0, 0, { text: "Release notes are late." }),
      other = item("note", 300, 0, { text: "Standups run long." }),
      hidden = item("note", 600, 0, { text: "Hidden idea." });
    b.items = [shown, other, hidden];
    const thread = (id, anchorId, messages, extra = {}) => ({
      id,
      x: 0,
      y: 0,
      anchorId,
      resolved: false,
      messages: messages.map((text, n) => ({
        id: `${id}${n}`,
        authorId: "u1",
        authorName: "Alice",
        text,
        createdAt: 1000 + n,
        ...(text === "Gone" ? { deleted: true } : {}),
      })),
      ...extra,
    });
    b.comments = [
      thread("t1", shown.id, ["Agreed, ship weekly.", "Gone", "Sam owns it."], {
        resolved: true,
      }),
      thread("t2", other.id, ["Try a 10 minute limit."]),
      thread("t3", hidden.id, ["Secret reply."]),
    ];
    const prompts = [],
      selected = new Set();
    const ai = createAI({
      org: {
        info: { role: "member" },
        allows: () => true,
        request: async (op, data) => {
          prompts.push(data.prompt);
          return { text: "Summary." };
        },
      },
      session: () => null,
      board: () => b,
      view: () => ({
        ...b,
        items: b.items.filter((i) => i.id !== hidden.id),
      }),
      concealed: () => new Set([hidden.id]),
      outcomes: () => [
        {
          kind: "vote",
          title: "What to fix first",
          participants: 6,
          results: [
            { label: "Release notes are late.", count: 5 },
            { label: "Standups run long.", count: 2 },
          ],
        },
      ],
      selection: () => selected,
      modal(title, html, init) {
        d = dom.window.document.createElement("dialog");
        d.open = true;
        d.innerHTML = html;
        d.close = () => d.remove();
        dom.window.document.body.append(d);
        init(d);
        return d;
      },
      icon: () => "",
      mutate: (fn) => fn(),
      center: () => ({ x: 0, y: 0 }),
      select() {},
      canEdit: () => true,
      toast() {},
      refresh() {},
      puter: () => null,
    });
    ai.open();
    await d.querySelector('[data-ai="summarize"]').onclick();
    const whole = prompts.at(-1);
    assert.match(whole, /Agreed, ship weekly\. \(resolved\)/);
    assert.match(whole, /reply: Sam owns it\./);
    assert.match(whole, /Try a 10 minute limit\./);
    assert.match(
      whole,
      /Dot vote "What to fix first" \(6 participants\): Release notes are late\. 5; Standups run long\. 2/,
    );
    assert.doesNotMatch(whole, /Secret reply|Hidden idea|Gone|Alice/);
    d.close();
    // A selection takes its own threads only, and no results.
    selected.add(other.id);
    ai.open();
    await d.querySelector('[data-ai="summarize"]').onclick();
    const part = prompts.at(-1);
    assert.match(part, /Try a 10 minute limit\./);
    assert.doesNotMatch(part, /ship weekly|What to fix first/);
  } finally {
    d?.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(descriptors))
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  }
});
