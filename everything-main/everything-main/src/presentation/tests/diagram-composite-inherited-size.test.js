import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-inherited-size-native.json";
import { parseXml, serializeXml } from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";

describe("composite automatic dimensions with inherited preferences", () => {
  it.each(native.cases)("matches native geometry: $name", (row) => {
    const document = parseXml(native.layouts[row.layout]);
    const data = parseXml(native.models[row.model]);
    const before = [serializeXml(document), serializeXml(data)];
    const root = expandDiagramLayout(
      document.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    );
    const states = evaluate(root, row.available);
    for (const expected of row.expected) {
      const node = root.children[0].children.find(
        (node) => node.name === expected.name,
      );
      const state = states.get(node);
      const actual = {
        x: state.coordinates.l,
        y: state.coordinates.t,
        ...state.size,
      };
      for (const key of ["x", "y", "w", "h"])
        expect(
          Math.abs(Math.trunc(actual[key] * 36000) - expected[key]),
          `${expected.name}.${key}`,
        ).toBeLessThanOrEqual(1);
    }
    expect([serializeXml(document), serializeXml(data)]).toEqual(before);
  });

  const fixture = (local) => {
    const row = native.cases[local ? 1 : 0];
    const document = parseXml(native.layouts[row.layout]);
    const root = expandDiagramLayout(
      document.root,
      readDiagramHierarchy(
        readDiagramDataModel(parseXml(native.models[row.model]).root),
      ),
    );
    return {
      root,
      body: root.children[0].children[1],
      available: row.available,
    };
  };
  const property = (relationship, name = "") => ({
    type: "h",
    selector: { relationship, name, pointType: "all" },
  });

  it("keeps the distant declaration referenceable without imposing it on an automatic child", () => {
    const { root, body, available } = fixture(false);
    const initial = evaluate(root, available);
    const changed = evaluate(root, available, {
      changes: [{ owner: root, property: property("des", "body"), value: 11 }],
    });
    expect(initial.get(root).reference(property("des", "body"))).toBe(8);
    expect(changed.get(root).reference(property("des", "body"))).toBe(11);
    expect(initial.get(body).size.h).toBe(60);
    expect(changed.get(body).size.h).toBe(60);
    expect(
      changed.get(root.children[0]).reference(property("ch", "body")),
    ).toBe(60);
  });

  it("reevaluates inherited preferences when the child declares its own dimension", () => {
    const { root, body, available } = fixture(true);
    const initial = evaluate(root, available);
    const changed = evaluate(root, available, {
      changes: [{ owner: root, property: property("des", "body"), value: 11 }],
    });
    expect(initial.get(body).size.h).toBe(8);
    expect(changed.get(body).size.h).toBe(11);
  });

  it("permits later local and ancestor rule trials without changing earlier results", () => {
    const { root, body, available } = fixture(false);
    const initial = evaluate(root, available);
    const local = evaluate(root, available, {
      changes: [{ owner: body, property: property("self"), value: 22 }],
    });
    const applied = evaluate(root, available, {
      adjustments: [
        { owner: root, property: property("des", "body"), value: 13 },
      ],
    });
    expect(local.get(body).size.h).toBe(22);
    expect(applied.get(body).size.h).toBe(13);
    expect(initial.get(body).size.h).toBe(60);
    expect(local.get(root).reference(property("des", "body"))).toBe(8);
  });
});
