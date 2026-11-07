import { describe, expect, it } from "vitest";
import native from "./data/diagram-arrange-native.json";
import boundary from "./data/diagram-linear-boundary-native.json";
import {
  arrangeDiagramChildren,
  positionDiagramLinearChildren,
  readDiagramArrangement,
} from "../lib/pptx/src/internal/diagram/arrange.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const algorithm = (type, parameters = "") =>
  parseXml(
    `<dgm:alg xmlns:dgm="${NS.diagram}" type="${type}">${parameters}</dgm:alg>`,
  );
const options = (type, parameters = "") =>
  readDiagramArrangement(algorithm(type, parameters).root);
const params = (values) =>
  Object.entries(values)
    .map(([type, val]) => `<dgm:param type="${type}" val="${val}"/>`)
    .join("");
const rect = (x, y, w, h) => ({ x, y, w, h });

describe("DiagramML child arrangement", () => {
  it.each([
    ["fromL", [rect(0, 0, 7, 12), rect(7, 5, 4, 2)]],
    ["fromR", [rect(4, 0, 7, 12), rect(0, 5, 4, 2)]],
    ["fromT", [rect(0, 0, 12, 7), rect(5, 7, 2, 4)]],
    ["fromB", [rect(0, 4, 12, 7), rect(5, 0, 2, 4)]],
  ])(
    "positions completed %s drawings beyond their allocation",
    (direction, expected) => {
      const children = expected.map(({ w, h }) =>
        Object.freeze(rect(90, -90, w, h)),
      );
      const available = Object.freeze({ w: 10, h: 10 });
      const arrangement = options(
        "lin",
        params({
          linDir: direction,
          horzAlign: "none",
          vertAlign: "none",
        }),
      );
      expect(
        positionDiagramLinearChildren(
          available,
          Object.freeze(children),
          arrangement,
        ),
      ).toEqual(expected);
      const horizontal = direction === "fromL" || direction === "fromR";
      expect(
        positionDiagramLinearChildren(available, children, {
          ...arrangement,
          horizontal: "ctr",
          vertical: "mid",
        }),
      ).toEqual(
        expected.map((r) => ({
          ...r,
          x: r.x - (horizontal ? 0.5 : 1),
          y: r.y - (horizontal ? 1 : 0.5),
        })),
      );
    },
  );

  it.each([...native.cases, ...boundary.cases])(
    "matches the native reference: $name",
    (row) => {
      const xml = algorithm(row.algorithm, row.parameters);
      const before = serializeXml(xml);
      const children = row.children.map((c) => Object.freeze({ ...c }));
      const result = arrangeDiagramChildren(
        Object.freeze({ ...row.available }),
        Object.freeze(children),
        readDiagramArrangement(xml.root),
      );
      expect(result).toHaveLength(row.expected.length);
      for (const [index, child] of result.entries()) {
        for (const dimension of ["x", "y", "w", "h"]) {
          // The native reference truncates final coordinates to integer EMUs.
          // A single EMU allows differences in floating-point expression
          // evaluation order; it is 1/36000 mm, not a visual tolerance for a
          // different layout.
          expect(
            Math.abs(
              Math.trunc(child[dimension] * 36000) -
                row.expected[index][dimension],
            ),
            `${index}.${dimension}`,
          ).toBeLessThanOrEqual(1);
        }
      }
      expect(serializeXml(xml)).toBe(before);
      expect(children).toEqual(row.children);
    },
  );

  it("is independent of units and child count, without intermediate quantization", () => {
    for (const type of ["lin", "composite"]) {
      const children = Array.from({ length: 37 }, (_, i) =>
        rect(i * 1.7, i * 0.3, 3 + i / 7, 5 + i / 13),
      );
      const available = { w: 67, h: 49 };
      const reference = arrangeDiagramChildren(
        available,
        children,
        options(type),
      );
      for (const factor of [1 / 127, 13, 36000]) {
        const scale = (r) =>
          Object.fromEntries(
            Object.entries(r).map(([k, v]) => [k, v * factor]),
          );
        const result = arrangeDiagramChildren(
          scale(available),
          children.map(scale),
          options(type),
        );
        for (const [index, child] of result.entries())
          for (const key of ["x", "y", "w", "h"])
            expect(child[key] / factor).toBeCloseTo(reference[index][key], 10);
      }
    }
  });

  it("preserves data order while reversing the placement direction", () => {
    const children = [rect(90, 90, 11, 13), rect(-90, -90, 17, 23)];
    const available = { w: 100, h: 100 };
    for (const [forward, backward, axis, length] of [
      ["fromL", "fromR", "x", "w"],
      ["fromT", "fromB", "y", "h"],
    ]) {
      const a = arrangeDiagramChildren(
        available,
        children,
        options("lin", params({ linDir: forward })),
      );
      const b = arrangeDiagramChildren(
        available,
        children,
        options("lin", params({ linDir: backward })),
      );
      for (const [i, child] of a.entries()) {
        expect(b[i].w).toBe(child.w);
        expect(b[i].h).toBe(child.h);
        expect(b[i][axis]).toBe(
          available[length] - child[axis] - child[length],
        );
      }
    }
  });

  it("handles empty, zero-size and zero-capacity layouts", () => {
    for (const type of ["lin", "composite"]) {
      expect(arrangeDiagramChildren({ w: 0, h: 0 }, [], options(type))).toEqual(
        [],
      );
      expect(
        arrangeDiagramChildren(
          { w: 0, h: 0 },
          [rect(0, 0, 3, 7), rect(0, 0, 5, 9)],
          options(type),
        ),
      ).toEqual([rect(0, 0, 0, 0), rect(0, 0, 0, 0)]);
      expect(
        arrangeDiagramChildren(
          { w: 40, h: 60 },
          [rect(0, 0, 0, 0)],
          options(type),
        ),
      ).toEqual([rect(20, 30, 0, 0)]);
    }
  });

  it("handles a large sibling collection without call-stack or argument overflow", () => {
    const children = Array.from({ length: 150000 }, () => rect(0, 0, 1, 1));
    for (const type of ["lin", "composite"]) {
      const result = arrangeDiagramChildren(
        { w: 150000, h: 1 },
        children,
        options(type),
      );
      expect(result).toHaveLength(children.length);
      expect(result.at(-1).w).toBe(1);
    }
  });

  it("rejects invalid dimensions and arithmetic overflow", () => {
    for (const type of ["lin", "composite"]) {
      for (const value of [NaN, Infinity, -Infinity, -1]) {
        expect(() =>
          arrangeDiagramChildren({ w: value, h: 1 }, [], options(type)),
        ).toThrow();
        expect(() =>
          arrangeDiagramChildren(
            { w: 1, h: 1 },
            [rect(0, 0, 1, value)],
            options(type),
          ),
        ).toThrow();
      }
      expect(() =>
        arrangeDiagramChildren(
          { w: 1, h: 1 },
          [rect(NaN, 0, 1, 1)],
          options(type),
        ),
      ).toThrow();
      expect(() =>
        arrangeDiagramChildren(
          { w: 1, h: 1 },
          [
            rect(0, 0, Number.MAX_VALUE, 1),
            rect(Number.MAX_VALUE, 0, Number.MAX_VALUE, 1),
          ],
          options(type),
        ),
      ).toThrow();
    }
  });

  it("finishes a fit with subnormal dimensions", () => {
    const result = arrangeDiagramChildren(
      { w: Number.MIN_VALUE, h: 1 },
      [rect(0, 0, 1, 1), rect(0, 0, 1, 1)],
      options("lin"),
    );
    for (const child of result)
      for (const value of Object.values(child))
        expect(Number.isFinite(value)).toBe(true);
  });
});

describe("DiagramML arrangement parameters", () => {
  it("reads algorithm-specific defaults and ignores extension payloads", () => {
    expect(options("lin")).toEqual({
      type: "lin",
      direction: "fromL",
      horizontal: "ctr",
      vertical: "mid",
    });
    expect(options("composite")).toEqual({
      type: "composite",
      aspectRatio: 0,
      horizontal: "ctr",
      vertical: "mid",
    });
    expect(
      options(
        "lin",
        `<dgm:extLst>${params({ linDir: "fromB" })}</dgm:extLst><x:param xmlns:x="urn:other" type="horzAlign" val="r"/>`,
      ),
    ).toEqual(options("lin"));
    expect(options("lin", params({ chAlign: "t", ar: 2 }))).toEqual(
      options("lin"),
    );
  });

  it.each([
    ["lin", { linDir: "sideways" }],
    ["lin", { horzAlign: "t" }],
    ["composite", { vertAlign: "l" }],
    ["composite", { ar: "NaN" }],
    ["composite", { ar: "Infinity" }],
    ["composite", { ar: "-1" }],
    ["composite", { ar: "0x10" }],
    ["composite", { ar: "" }],
  ])("rejects malformed %s parameters: %j", (type, values) => {
    expect(() => options(type, params(values))).toThrow();
  });

  it("reports an unsupported algorithm rather than applying another arrangement", () => {
    expect(() => options("cycle")).toThrow(
      "unsupported diagram arrangement algorithm",
    );
    expect(() =>
      readDiagramArrangement(parseXml('<alg type="lin"/>').root),
    ).toThrow("expected diagram algorithm");
    expect(() =>
      options("lin", params({ linDir: "fromL" }) + params({ linDir: "fromR" })),
    ).toThrow("duplicate diagram algorithm parameter");
  });
});
