import { describe, expect, it } from "vitest";
import native from "./data/diagram-constraint-changes-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const property = (type, relationship = "self", name = "") => ({
  type,
  selector: { relationship, name, pointType: "all" },
});
const create = (body, algorithm = "lin") => {
  const document = parseXml(
    `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="${algorithm}"/>${body}</dgm:layoutNode>`,
  );
  return { document, root: expandDiagramLayout(document.root, sample().tree) };
};
const child = (name, body = "", algorithm = "sp") =>
  `<dgm:layoutNode name="${name}"><dgm:alg type="${algorithm}"/>${body}</dgm:layoutNode>`;
const list = (body) => `<dgm:constrLst>${body}</dgm:constrLst>`;
const constraint = (type, attrs) => `<dgm:constr type="${type}" ${attrs}/>`;
const available = { w: 173, h: 89 };

describe("DiagramML scoped trial values", () => {
  it.each(native.cases)(
    "propagates native adjustment outcomes: $name",
    (row) => {
      const { root, document } = create(
        list(row.constraints) +
          `<dgm:ruleLst>${row.rules}</dgm:ruleLst>` +
          row.body,
        row.algorithm,
      );
      const before = serializeXml(document);
      const changes = row.changes.map((change) => ({
        ...change,
        owner: change.ownerIndex < 0 ? root : root.children[change.ownerIndex],
      }));
      const result = evaluate(root, native.available, { changes });
      expect(root.children).toHaveLength(row.expected.length);
      for (const [index, node] of root.children.entries()) {
        const expected = row.expected[index];
        expect([node.name, node.context.point.id]).toEqual([
          expected.name,
          expected.context,
        ]);
        for (const type of ["w", "h"])
          expect(
            Math.abs(
              Math.trunc(result.get(node).size[type] * 36000) - expected[type],
            ),
          ).toBeLessThanOrEqual(1);
        if (expected.x !== undefined)
          for (const [type, coordinate] of [
            ["x", "l"],
            ["y", "t"],
          ])
            expect(
              Math.abs(
                Math.trunc(result.get(node).coordinates[coordinate] * 36000) -
                  expected[type],
              ),
            ).toBeLessThanOrEqual(1);
      }
      expect(serializeXml(document)).toBe(before);
    },
  );

  it("distinguishes a child's inherited slot from its parent's reference declaration", () => {
    const { root } = create(
      list(
        constraint("primFontSz", 'for="ch" forName="title" val="27"') +
          constraint(
            "h",
            'for="ch" forName="probe" refFor="ch" refForName="title" refType="primFontSz"',
          ),
      ) +
        child(
          "title",
          list(
            constraint("primFontSz", 'forName="fontAlias" val="13"') +
              constraint(
                "lMarg",
                'refType="primFontSz" forName="marginAlias" fact="0.2"',
              ),
          ),
          "tx",
        ) +
        child("probe"),
    );
    const local = evaluate(root, available, {
      changes: [
        {
          owner: root.children[0],
          property: property("primFontSz", "self", "fontAlias"),
          value: 9,
        },
      ],
    });
    expect(local.get(root.children[0]).values.get("primFontSz")).toBe(9);
    expect(local.get(root.children[0]).values.get("lMarg")).toBeCloseTo(1.8);
    expect(local.get(root.children[1]).values.get("h")).toBe(27);
    expect(
      local.get(root).reference(property("primFontSz", "ch", "title")),
    ).toBe(27);
    const parent = evaluate(root, available, {
      changes: [
        {
          owner: root,
          property: property("primFontSz", "ch", "title"),
          value: 16,
        },
      ],
    });
    expect(parent.get(root.children[0]).values.get("primFontSz")).toBe(16);
    expect(parent.get(root.children[1]).values.get("h")).toBe(16);
    expect(local.get(root.children[0]).reference(property("primFontSz"))).toBe(
      9,
    );
    expect(
      evaluate(root, available).get(root.children[0]).values.get("primFontSz"),
    ).toBe(27);
  });

  it("retains an earlier named declaration when a later wildcard controls the applied width", () => {
    const { root } = create(
      list(
        constraint("w", 'for="ch" forName="item" val="31"') +
          constraint("w", 'for="ch" val="22"') +
          constraint(
            "h",
            'for="ch" forName="probe" refType="w" refFor="ch" refForName="item"',
          ),
      ) +
        child("item") +
        child("probe"),
    );
    const result = evaluate(root, available, {
      changes: [
        { owner: root, property: property("w", "ch", "item"), value: 17 },
      ],
    });
    expect(result.get(root.children[0]).values.get("w")).toBe(22);
    expect(result.get(root.children[1]).values.get("h")).toBe(17);
  });

  it("updates composite coordinates after changing an explicit child extent", () => {
    const { root } = create(
      list(
        constraint("w", 'for="ch" forName="item" val="23"') +
          constraint("r", 'for="ch" forName="item" val="70"') +
          constraint(
            "h",
            'for="ch" forName="probe" refType="l" refFor="ch" refForName="item"',
          ),
      ) +
        child("item") +
        child("probe"),
      "composite",
    );
    const result = evaluate(root, available, {
      changes: [
        { owner: root.children[0], property: property("w"), value: 38 },
      ],
    });
    expect(result.get(root.children[0]).coordinates).toMatchObject({
      l: 32,
      r: 70,
      w: 38,
    });
    expect(result.get(root.children[1]).values.get("h")).toBe(32);
  });

  it("keeps a preferred extent distinct from the extent constrained by composite coordinates", () => {
    const { root } = create(
      list(
        constraint("l", 'for="ch" forName="item" val="125"') +
          constraint("ctrX", 'for="ch" forName="item" val="140"') +
          constraint(
            "h",
            'for="ch" forName="probe" refType="r" refFor="ch" refForName="item" fact="0.1"',
          ),
      ) +
        child("item") +
        child("probe"),
      "composite",
    );
    const result = evaluate(
      root,
      { w: 200, h: 100 },
      {
        changes: [
          { owner: root.children[0], property: property("w"), value: 78.125 },
        ],
      },
    );
    const item = result.get(root.children[0]);
    expect(item.values.get("w")).toBe(78.125);
    expect(item.size.w).toBe(30);
    expect(item.coordinates).toMatchObject({
      l: 125,
      ctrX: 140,
      r: 155,
      w: 30,
    });
    expect(result.get(root.children[1]).size.h).toBe(15.5);
  });

  it("rejects unknown owners, undeclared names, alias collisions and nonfinite trials", () => {
    const { root } = create(
      child("item", list(constraint("w", 'forName="sizeAlias" val="15"'))),
    );
    const change = {
      owner: root.children[0],
      property: property("w"),
      value: 12,
    };
    expect(() =>
      evaluate(root, available, {
        changes: [{ ...change, owner: create("").root }],
      }),
    ).toThrow("unknown diagram change owner");
    expect(() =>
      evaluate(root, available, {
        changes: [{ ...change, property: property("w", "self", "missing") }],
      }),
    ).toThrow("unresolved diagram change variable");
    expect(() =>
      evaluate(root, available, {
        changes: [
          change,
          { ...change, property: property("w", "self", "sizeAlias") },
        ],
      }),
    ).toThrow("duplicate diagram change variable");
    for (const value of [NaN, Infinity, -Infinity])
      expect(() =>
        evaluate(root, available, { changes: [{ ...change, value }] }),
      ).toThrow("non-finite diagram constraint value");
    expect(
      evaluate(root, available).get(root.children[0]).values.get("w"),
    ).toBe(15);
  });
});
