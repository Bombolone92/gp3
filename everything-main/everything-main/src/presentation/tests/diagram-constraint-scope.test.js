import { describe, expect, it } from "vitest";
import native from "./data/diagram-initial-constraints-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { evaluateDiagramInitialConstraints } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const view = (s) => ({
  values: [...s.values],
  size: s.size,
  coordinates: s.coordinates,
});
const property = (type, relationship = "self", name = "") => ({
  type,
  selector: { relationship, name, pointType: "all" },
});
const setup = (body, algorithm = "lin") => {
  const xml = parseXml(
    `<d:layoutNode xmlns:d="${NS.diagram}" name="root"><d:alg type="${algorithm}"/>${body}</d:layoutNode>`,
  );
  return { xml, root: expandDiagramLayout(xml.root, sample().tree) };
};
const leaf = (name, contents = "", algorithm = "tx") =>
  `<d:layoutNode name="${name}"><d:alg type="${algorithm}"/>${contents}</d:layoutNode>`;
const adjustment = (owner, type, value, relationship = "self", name = "") => ({
  owner,
  property: property(type, relationship, name),
  value,
});
const size = { w: 200, h: 80 };
describe("isolated diagram constraint scopes", () => {
  it.each(native.cases.filter((c) => !c.rejected))(
    "retains native initial state when rebuilding $name",
    (row) => {
      const root = expandDiagramLayout(
          parseXml(
            `<d:layoutNode xmlns:d="${NS.diagram}" xmlns:dgm="${NS.diagram}" name="root"><d:alg type="${row.algorithm}"/><d:constrLst>${row.constraints}</d:constrLst>${row.body}</d:layoutNode>`,
          ).root,
          sample().tree,
        ),
        states = evaluateDiagramInitialConstraints(root, { w: 400, h: 100 });
      for (const [node, state] of states) {
        const rebuilt = state.evaluateScope();
        expect(rebuilt.has(node)).toBe(true);
        for (const [child, actual] of rebuilt)
          expect(view(actual), node.name + " -> " + child.name).toEqual(
            view(states.get(child)),
          );
      }
    },
  );
  it("retains ordered outer physical applications and resets local trials without rounding fitted fonts", () => {
    const { root } = setup(
        `<d:constrLst><d:constr type="primFontSz" for="ch" forName="text" val="14"/><d:constr type="primFontSz" for="ch" val="23"/></d:constrLst>${leaf("text")}`,
      ),
      text = root.children[0];
    const initial = evaluateDiagramInitialConstraints(root, size, {
      quantizeFonts: true,
      adjustments: [
        adjustment(root, "primFontSz", 17.25, "ch", "text"),
        adjustment(text, "primFontSz", 9),
      ],
    });
    expect(initial.get(text).values.get("primFontSz")).toBe(9);
    const first = initial.get(text).evaluateScope().get(text);
    expect(first.values.get("primFontSz")).toBe(17.25);
    expect(first.values.get("secFontSz")).toBe(13);
    expect(first.evaluateScope().get(text).values.get("primFontSz")).toBe(
      17.25,
    );
    const trial = first
      .evaluateScope({ adjustments: [adjustment(text, "primFontSz", 6)] })
      .get(text);
    expect(trial.values.get("primFontSz")).toBe(6);
    expect(first.values.get("primFontSz")).toBe(17.25);
    expect(
      initial.get(root).reference(property("primFontSz", "ch", "text")),
    ).toBe(17.25);
  });
  it("preserves ancestor precedence and authored local rule bases across independent trials", () => {
    const { xml, root } = setup(
        `<d:constrLst><d:constr type="userA" val="40"/><d:constr type="primFontSz" for="des" forName="text" refType="userA" fact=".5"/></d:constrLst>${leaf("column", leaf("text", '<d:constrLst><d:constr type="primFontSz" val="99"/></d:constrLst><d:ruleLst><d:rule type="primFontSz" fact=".1"/></d:ruleLst>'), "composite")}`,
      ),
      column = root.children[0],
      text = column.children[0],
      before = serializeXml(xml);
    const initial = evaluateDiagramInitialConstraints(root, size, {
        quantizeFonts: true,
      }),
      rebuilt = initial.get(column).evaluateScope();
    expect(rebuilt.get(text).values.get("primFontSz")).toBe(20);
    expect(rebuilt.get(text).rulePlan(rebuilt.get(text).rules[0])).toBeNull();
    for (const font of [7, 12, 5, 18])
      expect(
        rebuilt
          .get(text)
          .evaluateScope({
            adjustments: [adjustment(text, "primFontSz", font)],
          })
          .get(text)
          .values.get("primFontSz"),
      ).toBe(font);
    expect(rebuilt.get(text).values.get("primFontSz")).toBe(20);
    expect(initial.get(text).values.get("primFontSz")).toBe(20);
    expect(serializeXml(xml)).toBe(before);
  });
  it("reflows descendants at a changed parent preference without touching sibling scopes", () => {
    const { root } = setup(
        leaf(
          "column",
          `<d:constrLst><d:constr type="w" val="100"/><d:constr type="h" val="60"/><d:constr type="h" for="ch" forName="header" refType="w" fact=".1"/><d:constr type="t" for="ch" forName="body" refType="b" refFor="ch" refForName="header"/></d:constrLst>${leaf("header")}${leaf("body")}`,
          "composite",
        ) + leaf("other"),
      ),
      column = root.children[0],
      [header, body] = column.children;
    const original = evaluateDiagramInitialConstraints(root, size),
      old = original.get(column),
      seen = [];
    for (const w of [50, 125, 80]) {
      const rebuilt = old.evaluateScope({
        changes: [adjustment(column, "w", w)],
        defaults: (node) => {
          seen.push(node);
          return new Map();
        },
      });
      expect([...rebuilt.keys()]).toEqual([column, header, body]);
      expect(rebuilt.get(header).size).toEqual({ w, h: w * 0.1 });
      expect(rebuilt.get(body).size).toEqual({ w, h: 60 - w * 0.1 });
    }
    expect(seen).toEqual([
      column,
      header,
      body,
      column,
      header,
      body,
      column,
      header,
      body,
    ]);
    expect(original.get(body).size).toEqual({ w: 100, h: 50 });
  });
  it("uses only local equality domains while the containing result retains outer groups", () => {
    const { root } = setup(
        `<d:constrLst><d:constr type="primFontSz" for="des" op="equ" val="0"/></d:constrLst>${leaf("column", `<d:constrLst><d:constr type="h" for="ch" op="equ" val="0"/></d:constrLst>${leaf("a")}${leaf("b")}`, "composite")}${leaf("other")}`,
      ),
      column = root.children[0],
      a = column.children[0],
      initial = evaluateDiagramInitialConstraints(root, size),
      local = initial.get(column).evaluateScope();
    expect(
      initial
        .get(a)
        .equalityTrial("primFontSz", 12)
        .scopes.map((s) => s.scope),
    ).toContain(root);
    expect(local.get(a).equalityTrial("primFontSz", 12).scopes).toEqual([]);
    expect(
      local
        .get(a)
        .equalityTrial("h", 12)
        .scopes.map((s) => s.scope),
    ).toEqual([column]);
  });
  it("bounds each isolated trial independently and rejects foreign changes", () => {
    const { root } = setup(
        Array.from({ length: 250 }, (_, i) => leaf("text" + i)).join(""),
      ),
      initial = evaluateDiagramInitialConstraints(root, size),
      first = root.children[0];
    expect(() =>
      evaluateDiagramInitialConstraints(root, size, { maxOperations: 1000 }),
    ).toThrow("operation budget");
    for (let i = 0; i < 50; i++)
      expect(
        initial.get(first).evaluateScope({ maxOperations: 1000 }).size,
      ).toBe(1);
    expect(() =>
      initial
        .get(first)
        .evaluateScope({ changes: [adjustment(root.children[1], "w", 10)] }),
    ).toThrow("unknown diagram change owner");
    expect(initial.get(first).evaluateScope().get(first).size).toEqual({
      w: 100,
      h: 100,
    });
  });
  it("does not execute ancestor preferences shadowed by composite coordinates", () => {
    const { root } = setup(
        `<d:constrLst><d:constr type="h" for="des" forName="text" refType="userZ"/></d:constrLst>${leaf("column", '<d:constrLst><d:constr type="w" val="100"/><d:constr type="h" val="60"/></d:constrLst>' + leaf("text"), "composite")}`,
      ),
      column = root.children[0],
      text = column.children[0];
    const initial = evaluateDiagramInitialConstraints(root, size);
    expect(initial.get(text).size.h).toBe(60);
    expect(initial.get(column).evaluateScope().get(text).size.h).toBe(60);
    expect(() =>
      initial.get(root).reference(property("h", "des", "text")),
    ).toThrow("unresolved");
  });
  it("does not publish a rejected child trial into its containing composite", () => {
    const { root } = setup(
        leaf(
          "a",
          '<d:constrLst><d:constr type="w" val="20"/><d:constr type="h" val="10"/></d:constrLst>',
        ) + leaf("b"),
        "composite",
      ),
      a = root.children[0],
      initial = evaluateDiagramInitialConstraints(root, size);
    expect(initial.get(root).reference(property("w", "ch", "a"))).toBe(20);
    const trial = initial
      .get(a)
      .evaluateScope({ adjustments: [adjustment(a, "w", 35)] });
    expect(trial.get(a).size.w).toBe(35);
    expect(initial.get(root).reference(property("w", "ch", "a"))).toBe(20);
    expect(initial.get(a).evaluateScope().get(a).size.w).toBe(20);
  });
});
