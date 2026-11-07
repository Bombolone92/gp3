import { describe, expect, it } from "vitest";
import native from "./data/diagram-equality-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import {
  propagateDiagramEquality,
  compatibleDiagramEqualityValues,
} from "../lib/pptx/src/internal/diagram/equality.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const create = (constraints, body, algorithm = "lin") => {
  const data = sample();
  const document = parseXml(
    `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="${algorithm}"/><dgm:constrLst>${constraints}</dgm:constrLst>${body}</dgm:layoutNode>`,
  );
  return {
    document,
    data: data.document,
    root: expandDiagramLayout(document.root, data.tree),
  };
};
const child = (name, body = "", alg = "sp") =>
  `<dgm:layoutNode name="${name}"><dgm:alg type="${alg}"/>${body}</dgm:layoutNode>`;
const property = (type, relationship = "self", name = "") => ({
  type,
  selector: { relationship, name, pointType: "all" },
});
const size = { w: 300, h: 100 };
const pair = () =>
  create(
    '<dgm:constr type="w" for="ch" forName="a" val="37"/><dgm:constr type="w" for="ch" forName="b" refType="w" refFor="ch" refForName="a" fact="0.25" op="equ"/>',
    child("a") + child("b"),
  );

describe("DiagramML local equality propagation", () => {
  it.each([
    ["norm", "nonAsst", "node"],
    ["asst", "nonNorm", "asst"],
  ])(
    "joins equality domains through %s/%s aliases",
    (base, alias, selectedType) => {
      const { root } = create(
        `<dgm:constr type="w" for="ch" forName="a" ptType="${base}" val="37"/>
      <dgm:constr type="w" for="ch" forName="b" ptType="${base}" refType="w" refFor="ch" refForName="a" refPtType="${alias}" op="equ" fact=".5"/>`,
        `<dgm:forEach axis="ch" ptType="node">${child("a", '<dgm:constrLst><dgm:constr type="w" val="3"/></dgm:constrLst>')}${child("b", '<dgm:constrLst><dgm:constr type="w" val="3"/></dgm:constrLst>')}</dgm:forEach>`,
      );
      const initial = evaluate(root, size),
        seed = root.children.find(
          (node) =>
            node.name === "a" && node.context.point.type === selectedType,
        ),
        changes = initial.get(seed).equalityChanges("w", 20),
        changed = evaluate(root, size, { changes });
      for (const node of root.children) {
        const selected = node.context.point.type === selectedType;
        expect(changed.get(node).values.get("w")).toBe(
          selected ? (node.name === "a" ? 20 : 10) : 3,
        );
        expect(initial.get(node).values.get("w")).toBe(
          selected ? (node.name === "a" ? 37 : 18.5) : 3,
        );
      }
    },
  );
  it.each(["none", "root", "column", "both"])(
    "retains %s ownership independently of the projected physical slots",
    (scope) => {
      const equality = (relationship) =>
        `<dgm:constr type="h" for="${relationship}" forName="entry" op="equ"/>`;
      const { root, document } = create(
        scope === "root" || scope === "both" ? equality("des") : "",
        child(
          "column",
          `<dgm:constrLst><dgm:constr type="w" val="120"/><dgm:constr type="h" val="90"/>
          ${scope === "column" || scope === "both" ? equality("ch") : ""}</dgm:constrLst>
          <dgm:forEach axis="ch" ptType="node">${child("entry", '<dgm:constrLst><dgm:constr type="w" val="20"/><dgm:constr type="h" val="4"/></dgm:constrLst>')}</dgm:forEach>`,
          "composite",
        ),
      );
      const column = root.children[0],
        seed = column.children[0];
      const before = serializeXml(document),
        initial = evaluate(root, size);
      const trial = initial.get(seed).equalityTrial("h", 11);
      const scopes =
        scope === "none"
          ? []
          : scope === "root"
            ? [root]
            : scope === "column"
              ? [column]
              : [root, column];
      expect(trial.scopes.map((s) => s.scope)).toEqual(scopes);
      expect(trial.scopes.map((s) => s.property)).toEqual(
        scopes.map((owner) =>
          property("h", owner === root ? "des" : "ch", "entry"),
        ),
      );
      expect(trial.scopes.every((s) => s.value === 11)).toBe(true);
      expect(trial.changes.map((c) => c.owner)).toEqual(
        scope === "none" ? [seed] : column.children,
      );
      expect(trial.changes).toEqual(initial.get(seed).equalityChanges("h", 11));
      expect(
        initial
          .get(seed)
          .equalityTrial("h", 22)
          .scopes.every((s) => s.value === 22),
      ).toBe(true);
      expect(trial.scopes.every((s) => s.value === 11)).toBe(true);
      expect(initial.get(seed).values.get("h")).toBe(4);
      expect(serializeXml(document)).toBe(before);
    },
  );

  it("exposes proportional virtual domains without replacing their authored references", () => {
    const { root } = create(
      '<dgm:constr type="w" for="ch" forName="a" val="17"/><dgm:constr type="primFontSz" for="ch" forName="probe" refType="w" refFor="ch" refForName="a" fact="2" op="equ"/><dgm:constr type="h" for="ch" forName="b" refType="primFontSz" refFor="ch" refForName="probe" op="equ"/>',
      child("a") + child("probe") + child("b"),
    );
    const initial = evaluate(root, size),
      seed = initial.get(root.children[0]);
    const trial = seed.equalityTrial("w", 12);
    expect(trial.scopes).toEqual([
      { scope: root, property: property("w", "ch", "a"), value: 12 },
      {
        scope: root,
        property: property("primFontSz", "ch", "probe"),
        value: 24,
      },
      { scope: root, property: property("h", "ch", "b"), value: 24 },
    ]);
    expect(trial.changes.map((c) => c.owner.name)).toEqual(["a", "b"]);
    expect(
      initial.get(root).reference(property("primFontSz", "ch", "probe")),
    ).toBe(34);
    // Returned metadata must not allow a caller to corrupt the cached graph.
    trial.scopes[0].property.selector.name = "changed-by-caller";
    expect(seed.equalityTrial("w", 12).scopes[0].property.selector.name).toBe(
      "a",
    );
  });

  it.each(native.cases)("matches native trial propagation: $name", (row) => {
    const { document, data, root } = create(
      row.constraints,
      row.body,
      row.algorithm,
    );
    const before = [serializeXml(document), serializeXml(data)];
    const initial = evaluate(root, row.available),
      seed = root.children[row.seed.ownerIndex];
    const initialValues = [...initial].map(([node, state]) => [
      node,
      [...state.values],
    ]);
    const changes = initial
      .get(seed)
      .equalityChanges(row.seed.type, row.seed.value);
    expect(
      initial.get(seed).equalityTrial(row.seed.type, row.seed.value).changes,
    ).toEqual(changes);
    const result = evaluate(root, row.available, { changes });
    expect(root.children).toHaveLength(row.expected.length);
    for (const [i, node] of root.children.entries()) {
      expect([node.name, node.context.point.id]).toEqual([
        row.expected[i].name,
        row.expected[i].context,
      ]);
      if (row.expected[i].fontSize !== undefined)
        expect(result.get(node).values.get("primFontSz")).toBeCloseTo(
          row.expected[i].fontSize,
          10,
        );
      for (const type of ["w", "h"])
        if (row.expected[i][type] !== undefined)
          expect(
            Math.abs(
              result.get(node).size[type] * 36000 - row.expected[i][type],
            ),
          ).toBeLessThanOrEqual(1);
    }
    expect(
      [...initial].map(([node, state]) => [node, [...state.values]]),
    ).toEqual(initialValues);
    expect([serializeXml(document), serializeXml(data)]).toEqual(before);
    expect(
      initial.get(seed).equalityChanges(row.seed.type, row.seed.value),
    ).toEqual(changes);
  });

  it("keeps parent reference declarations unchanged and returns independent trial arrays", () => {
    const { root } = pair(),
      [a, b] = root.children,
      initial = evaluate(root, size);
    const changes = initial.get(b).equalityChanges("w", 13);
    const result = evaluate(root, size, { changes });
    expect(result.get(a).values.get("w")).toBe(52);
    expect(result.get(b).values.get("w")).toBe(13);
    expect(result.get(root).reference(property("w", "ch", "a"))).toBe(37);
    expect(result.get(root).reference(property("w", "ch", "b"))).toBe(9.25);
    changes[0].value = 99;
    expect(initial.get(b).equalityChanges("w", 13)[0].value).toBe(13);
  });

  it("severs a reference edge when a scoped declaration has been numerically replaced", () => {
    const { root } = pair(),
      [a, b] = root.children;
    const replaced = {
      owner: root,
      property: property("w", "ch", "b"),
      value: 15,
    };
    const initial = evaluate(root, size, { changes: [replaced] });
    const changes = initial.get(b).equalityChanges("w", 11);
    const result = evaluate(root, size, { changes: [replaced, ...changes] });
    expect(result.get(a).values.get("w")).toBe(37);
    expect(result.get(b).values.get("w")).toBe(11);
    expect(result.get(root).reference(property("w", "ch", "b"))).toBe(15);
  });

  it("propagates font and cross-property equalities without font rounding or unit conversion", () => {
    const { root } = create(
      '<dgm:constr type="primFontSz" for="ch" forName="a" val="23"/><dgm:constr type="primFontSz" for="ch" forName="b" refType="primFontSz" refFor="ch" refForName="a" fact="0.7" op="equ"/><dgm:constr type="h" for="ch" forName="c" refType="primFontSz" refFor="ch" refForName="b" fact="3" op="equ"/>',
      child("a", "", "tx") + child("b", "", "tx") + child("c"),
    );
    const initial = evaluate(root, size),
      changes = initial
        .get(root.children[0])
        .equalityChanges("primFontSz", 17.5),
      result = evaluate(root, size, { changes });
    expect(result.get(root.children[1]).values.get("primFontSz")).toBe(12.25);
    expect(result.get(root.children[2]).size.h).toBe(36.75);
  });

  it("does not turn zero-valued equality groups into base reference declarations", () => {
    const { root } = create(
      '<dgm:constr type="w" for="des" val="25" op="equ"/><dgm:constr type="w" for="ch" forName="a" op="equ"/><dgm:constr type="h" for="ch" forName="b" refType="w" refFor="ch" refForName="a" op="equ"/>',
      child("a") + child("b"),
    );
    // The named zero-valued equality is a group, not a base reference binding.
    expect(() => evaluate(root, size)).toThrow("unresolved diagram constraint");
  });

  it("projects font domains only onto algorithms exposing font variables", () => {
    const { root } = create(
      '<dgm:constr type="primFontSz" for="ch" val="28" op="equ"/>',
      child("a", "", "tx") + child("b") + child("c", "", "tx"),
    );
    const initial = evaluate(root, size),
      changes = initial.get(root.children[0]).equalityChanges("primFontSz", 12);
    expect(changes.map((c) => c.owner.name)).toEqual(["a", "c"]);
    const result = evaluate(root, size, { changes });
    expect(result.get(root.children[1]).values.has("primFontSz")).toBe(false);
    expect(result.get(root.children[2]).values.get("primFontSz")).toBe(12);
  });

  it("does not reactivate a superseded local user-variable formula", () => {
    const { root } = create(
      "",
      child(
        "container",
        '<dgm:constrLst><dgm:constr type="userA" forName="old" refType="w" refFor="ch" refForName="nested" op="equ"/><dgm:constr type="userA" forName="new" val="14"/><dgm:constr type="w" for="ch" forName="nested" val="8"/></dgm:constrLst>' +
          child("nested"),
        "lin",
      ),
    );
    const container = root.children[0],
      nested = container.children[0],
      initial = evaluate(root, size);
    const changes = initial.get(nested).equalityChanges("w", 11),
      result = evaluate(root, size, { changes });
    expect(result.get(container).values.get("userA")).toBe(14);
  });

  it("retains reference domains even when their selected algorithms have no physical slot", () => {
    const { root } = create(
      '<dgm:constr type="w" for="ch" forName="a" val="17"/><dgm:constr type="primFontSz" for="ch" forName="probe" refType="w" refFor="ch" refForName="a" fact="2" op="equ"/><dgm:constr type="h" for="ch" forName="b" refType="primFontSz" refFor="ch" refForName="probe" op="equ"/>',
      child("a") + child("probe") + child("b"),
    );
    const initial = evaluate(root, size),
      changes = initial.get(root.children[0]).equalityChanges("w", 12),
      result = evaluate(root, size, { changes });
    expect(changes.map((c) => c.owner.name)).toEqual(["a", "b"]);
    expect(result.get(root.children[2]).size.h).toBe(24);
    expect(
      result.get(root).reference(property("primFontSz", "ch", "probe")),
    ).toBe(34);
  });

  it("rejects positional equality propagation until coordinate adjustment is available", () => {
    const { root } = create(
      '<dgm:constr type="r" for="ch" forName="a" val="41"/><dgm:constr type="w" for="ch" forName="b" refType="r" refFor="ch" refForName="a" op="equ"/>',
      child("a") + child("b"),
    );
    expect(() =>
      evaluate(root, size).get(root.children[1]).equalityChanges("w", 12),
    ).toThrow("unsupported diagram equality variable r");
  });

  it("rejects nonfinite trials, unavailable slots, zero proportional factors and exhausted work", () => {
    const { root } = pair(),
      initial = evaluate(root, size);
    for (const value of [NaN, Infinity, -Infinity])
      expect(() => initial.get(root).equalityChanges("w", value)).toThrow(
        "non-finite",
      );
    expect(() => initial.get(root).equalityChanges("primFontSz", 12)).toThrow(
      "unresolved diagram equality trial",
    );
    const zero = create(
      '<dgm:constr type="w" for="ch" forName="a" val="37"/><dgm:constr type="w" for="ch" forName="b" refType="w" refFor="ch" refForName="a" fact="0" op="equ"/>',
      child("a") + child("b"),
    ).root;
    expect(() =>
      evaluate(zero, size).get(zero.children[0]).equalityChanges("w", 12),
    ).toThrow("invalid diagram equality factor");
    const localZero = create(
      "",
      child(
        "a",
        '<dgm:constrLst><dgm:constr type="h" val="20"/><dgm:constr type="w" refType="h" fact="0" op="equ"/></dgm:constrLst>',
      ),
    ).root;
    expect(() =>
      evaluate(localZero, size)
        .get(localZero.children[0])
        .equalityChanges("w", 12),
    ).toThrow("invalid diagram equality factor");
    let operations = 0;
    expect(() =>
      propagateDiagramEquality(
        [{ source: 0, target: 1, factor: 2 }],
        [0],
        1,
        () => {
          if (++operations > 2) throw Error("budget");
        },
      ),
    ).toThrow("budget");
  });
});

describe("DiagramML proportional equality arithmetic", () => {
  const step = () => {};
  it("handles long bidirectional chains without recursion", () => {
    const relations = Array.from({ length: 12000 }, (_, source) => ({
      source,
      target: source + 1,
      factor: source % 2 === 0 ? 2 : 0.5,
    }));
    const result = propagateDiagramEquality(relations, [12000], 7, step);
    expect(result.size).toBe(12001);
    expect(result.get(0).value).toBe(7);
    expect(result.get(1).value).toBe(14);
  });
  it("allows signed and tiny factors without overflowing their reciprocals", () => {
    const result = propagateDiagramEquality(
      [{ source: "a", target: "b", factor: -1e-310 }],
      ["b"],
      -1e-310,
      step,
    );
    expect(result.get("a").value).toBe(1);
  });
  it("accepts roundoff in consistent cycles but rejects contradictory trials", () => {
    expect(
      compatibleDiagramEqualityValues(
        { value: 1.7e308, error: 9e307 },
        { value: -1.7e308, error: 9e307 },
      ),
    ).toBe(false);
    const relations = [
      { source: "a", target: "b", factor: 0.1 },
      { source: "b", target: "c", factor: 0.2 },
      { source: "a", target: "c", factor: 0.02 },
    ];
    expect(
      propagateDiagramEquality(relations, ["a"], 3, step).get("c").value,
    ).toBeCloseTo(0.06);
    expect(() =>
      propagateDiagramEquality(
        [...relations, { source: "c", target: "a", factor: 49 }],
        ["a"],
        3,
        step,
      ),
    ).toThrow("inconsistent");
    expect(() =>
      propagateDiagramEquality(
        [{ source: "a", target: "b", factor: 2 }],
        ["a", "b"],
        3,
        step,
      ),
    ).toThrow("inconsistent");
  });
  it("rejects invalid factors and overflowing propagated values", () => {
    for (const factor of [0, NaN, Infinity, -Infinity])
      expect(() =>
        propagateDiagramEquality(
          [{ source: 0, target: 1, factor }],
          [0],
          1,
          step,
        ),
      ).toThrow("invalid diagram equality factor");
    expect(() =>
      propagateDiagramEquality(
        [{ source: 0, target: 1, factor: 1e308 }],
        [0],
        2,
        step,
      ),
    ).toThrow("non-finite");
  });
});
