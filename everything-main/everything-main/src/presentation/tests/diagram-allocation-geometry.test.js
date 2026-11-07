import { describe, expect, it } from "vitest";
import native from "./data/diagram-allocation-geometry-native.json";
import {
  NS,
  parseXml,
  serializeXml,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import {
  arrangeDiagramChildren,
  readDiagramArrangement,
} from "../lib/pptx/src/internal/diagram/arrange.ts";
import { fitDiagramTextHeightGroup } from "../lib/pptx/src/internal/diagram/rule-fit.ts";
const property = (type) => ({
  type,
  selector: { relationship: "self", name: "", pointType: "all" },
});
const change = (owner, type, value) => ({
  owner,
  property: property(type),
  value,
});
const heightPlan = (state) => {
  const rule = state.rules.find((r) => r.target.type === "h"),
    plan = state.rulePlan(rule);
  const limits = state.constraints
    .filter((c) => c.target.type === "h" && c.operator === "lte")
    .map((c) =>
      c.reference.type === "none"
        ? c.value
        : state.reference(c.reference) * c.factor,
    );
  return { ...plan, limit: Math.min(plan.limit, ...limits) };
};
const ancestor = (node, parent) => {
  for (let n = node.parent; n; n = n.parent) if (n === parent) return true;
  return false;
};
const prepare = (row) => {
  const data = parseXml(native.models[row.model]),
    layout = parseXml(native.layouts[row.layout]);
  return {
    data,
    layout,
    root: expandDiagramLayout(
      layout.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    ),
  };
};
const near = (actual, expected) =>
  expect(
    Math.abs(Math.trunc(actual * 36000) - Number(expected)),
  ).toBeLessThanOrEqual(1);
describe("SmartArt reserved geometry and final drawing positions", () => {
  it.each(native.cases)("matches native composite reflow: $name", (row) => {
    const { data, layout, root } = prepare(row),
      before = [serializeXml(data), serializeXml(layout)];
    const wide = evaluate(root, row.available, { quantizeFonts: true });
    const headers = root.children.flatMap((column) =>
      column.children.filter(
        (node) => getAttrValue(node.algorithm, qname("", "type", "")) === "tx",
      ),
    );
    const [header] = headers,
      column = header.parent;
    const requirements = (value) => (Array.isArray(value) ? value : [value]);
    const predicates = (value) =>
      requirements(value).map((required) => (h) => h >= required);
    const initialFit = fitDiagramTextHeightGroup(
      heightPlan(wide.get(header)),
      predicates(row.required.wide),
    );
    const arrangement = readDiagramArrangement(root.algorithm);
    let arranged = arrangeDiagramChildren(
      row.available,
      root.children.map((n) => ({ x: 0, y: 0, ...wide.get(n).size })),
      arrangement,
    );
    const resize = () =>
      root.children.flatMap((node, i) =>
        ["w", "h"].map((type) => change(node, type, arranged[i][type])),
      );
    let changes = resize(),
      narrow = evaluate(root, row.available, { changes, quantizeFonts: true });
    const retained = wide
      .get(header)
      .equalityTrial("h", initialFit.allocation.value)
      .scopes.some((s) => ancestor(column, s.scope))
      ? initialFit.allocation.value
      : undefined;
    let fit = fitDiagramTextHeightGroup(
      heightPlan(narrow.get(header)),
      predicates(row.required.narrow),
      retained,
    );
    expect(fit.fits).toBe(row.expectedFit ?? true);
    if (row.retryRequired) {
      arranged = arrangeDiagramChildren(row.available, arranged, arrangement, {
        childrenFit: false,
      });
      changes = resize();
      narrow = evaluate(root, row.available, { changes, quantizeFonts: true });
      fit = fitDiagramTextHeightGroup(
        heightPlan(narrow.get(header)),
        predicates(row.retryRequired),
        fit.allocation.value,
      );
      expect(fit.fits).toBe(false);
    }
    const allocations = evaluate(root, row.available, {
      changes,
      adjustments: narrow
        .get(header)
        .equalityChanges("h", fit.allocation.value),
    });
    const drawing = evaluate(root, row.available, {
      changes,
      adjustments: narrow.get(header).equalityChanges("h", fit.drawing.value),
      allocations,
    });
    const shapes = root.children.flatMap((column, index) =>
      column.children.map((node) => ({ node, index })),
    );
    expect(shapes).toHaveLength(row.expected.length);
    for (const [index, { node, index: columnIndex }] of shapes.entries()) {
      const state = drawing.get(node),
        expected = row.expected[index];
      near(state.coordinates.l + arranged[columnIndex].x, expected.x);
      near(state.coordinates.t + arranged[columnIndex].y, expected.y);
      near(state.size.w, expected.cx);
      near(state.size.h, expected.cy);
    }
    expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
  });
  it("retains only automatic geometry and keeps accepted allocations independent of drawing trials", () => {
    const row = native.cases[0],
      { root } = prepare(row),
      column = root.children[0],
      [header, body] = column.children,
      changes = [change(column, "w", 80)];
    const allocations = evaluate(root, row.available, {
      changes,
      adjustments: [change(header, "h", 12)],
    });
    for (const h of [5, 10, 7]) {
      const drawing = evaluate(root, row.available, {
        changes,
        adjustments: [change(header, "h", h)],
        allocations,
      });
      expect(drawing.get(body).size).toEqual({ w: 80, h: 48 });
      expect(drawing.get(body).values.get("h")).toBe(48);
      expect(drawing.get(body).reference(property("h"))).toBe(48);
      expect(drawing.get(body).coordinates.t).toBe(h);
      expect(allocations.get(header).size.h).toBe(12);
    }
    const overridden = evaluate(root, row.available, {
      changes,
      adjustments: [change(header, "h", 7), change(body, "h", 25)],
      allocations,
    });
    expect(overridden.get(body).size.h).toBe(25);
    expect(overridden.get(body).coordinates.t).toBe(7);
  });
  it("resets local allocations on subtree reflow unless explicitly retained", () => {
    const row = native.cases[0],
      { root } = prepare(row),
      column = root.children[0],
      [header, body] = column.children,
      changes = [change(column, "w", 80)];
    const allocations = evaluate(root, row.available, {
        changes,
        adjustments: [change(header, "h", 12)],
      }),
      drawing = evaluate(root, row.available, {
        changes,
        adjustments: [change(header, "h", 7)],
        allocations,
      });
    expect(drawing.get(body).evaluateScope().get(body).size.h).toBe(53);
    expect(
      drawing
        .get(body)
        .evaluateScope({
          allocations: new Map([[body, allocations.get(body)]]),
        })
        .get(body).size.h,
    ).toBe(48);
    expect(drawing.get(body).size.h).toBe(48);
  });
  it("applies the same coordinate retention to horizontal automatic dimensions", () => {
    const row = native.cases[0],
      data = parseXml(native.models[row.model]);
    const axes = {
      w: "h",
      h: "w",
      l: "t",
      t: "l",
      r: "b",
      b: "r",
      ctrX: "ctrY",
      ctrY: "ctrX",
    };
    const layout = parseXml(
      native.layouts[row.layout].replace(
        /(type|refType)="(w|h|l|t|r|b|ctrX|ctrY)"/g,
        (_, attribute, type) => `${attribute}="${axes[type]}"`,
      ),
    );
    const root = expandDiagramLayout(
        layout.root,
        readDiagramHierarchy(readDiagramDataModel(data.root)),
      ),
      column = root.children[0],
      [header, body] = column.children,
      changes = [change(column, "h", 80)];
    const allocations = evaluate(root, row.available, {
        changes,
        adjustments: [change(header, "w", 12)],
      }),
      drawing = evaluate(root, row.available, {
        changes,
        adjustments: [change(header, "w", 7)],
        allocations,
      });
    expect(drawing.get(body).size).toEqual({ w: 48, h: 80 });
    expect(drawing.get(body).coordinates.l).toBe(7);
  });
  it("rejects allocations from different layout identities or fabricated results", () => {
    const row = native.cases[0],
      { root } = prepare(row),
      other = prepare(row).root,
      original = evaluate(root, row.available),
      foreign = evaluate(other, row.available);
    expect(() =>
      evaluate(root, row.available, { allocations: foreign }),
    ).toThrow("unknown diagram allocation owner");
    expect(() =>
      evaluate(root, row.available, {
        allocations: new Map([[root, foreign.get(other)]]),
      }),
    ).toThrow("invalid diagram allocation source");
    expect(() =>
      evaluate(root, row.available, {
        allocations: new Map([[root, { ...original.get(root) }]]),
      }),
    ).toThrow("invalid diagram allocation source");
  });
});
