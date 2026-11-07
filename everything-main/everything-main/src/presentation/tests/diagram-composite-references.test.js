import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-references-native.json";
import {
  resolveDiagramCompositeCoordinates,
  resolveDiagramCompositeRect,
} from "../lib/pptx/src/internal/diagram/composite.ts";
import {
  readDiagramConstraint,
  diagramConstraintValue,
} from "../lib/pptx/src/internal/diagram/constraint.ts";
import { arrangeDiagramChildren } from "../lib/pptx/src/internal/diagram/arrange.ts";
import {
  NS,
  parseXml,
  childElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const available = { w: 400, h: 100 };
const rectangle = (coordinates) => ({
  x: coordinates.l,
  y: coordinates.t,
  w: coordinates.w,
  h: coordinates.h,
});

describe("DiagramML composite coordinates exposed to references", () => {
  it.each(native.cases)("matches the native reference: $name", (row) => {
    const elements = childElements(
      parseXml(
        `<d:constrLst xmlns:d="${NS.diagram}" xmlns:dgm="${NS.diagram}">${row.constraints}</d:constrLst>`,
      ).root,
    );
    const constraints = elements.map(readDiagramConstraint);
    // Isolate coordinate derivation from scope/algorithm registration: these
    // controls have two named children, absolute A coordinates, and one B
    // coordinate that references A. This is not a general scope evaluator.
    const a = Object.fromEntries(
      constraints
        .filter((c) => c.target.selector.name === "a")
        .map((c) => {
          expect(c.reference.type).toBe("none");
          return [c.target.type, diagramConstraintValue(c)];
        }),
    );
    const coordinates = resolveDiagramCompositeCoordinates(available, a);
    const b = Object.fromEntries(
      constraints
        .filter((c) => c.target.selector.name === "b")
        .map((c) => {
          if (c.reference.type !== "none")
            expect(c.reference.selector).toEqual({
              relationship: "ch",
              name: "a",
              pointType: "all",
            });
          return [
            c.target.type,
            diagramConstraintValue(c, coordinates[c.reference.type]),
          ];
        }),
    );
    const results = arrangeDiagramChildren(
      available,
      [rectangle(coordinates), resolveDiagramCompositeRect(available, b)],
      {
        type: "composite",
        aspectRatio: 0,
        horizontal: "none",
        vertical: "none",
      },
    );
    expect(row.expected.map((r) => r.name)).toEqual(["a", "b"]);
    for (const [index, expected] of row.expected.entries())
      for (const key of ["x", "y", "w", "h"])
        expect(
          Math.abs(
            Math.trunc(results[index][key] * 36000) - expected.bounds[key],
          ),
        ).toBeLessThanOrEqual(1);
  });

  it("retains a lone center for references without moving a zero-width rectangle", () => {
    const values = Object.freeze({ ctrX: 47, ctrY: 31 });
    expect(resolveDiagramCompositeCoordinates(available, values)).toEqual({
      l: 0,
      ctrX: 47,
      r: 0,
      w: 0,
      t: 0,
      ctrY: 31,
      b: 0,
      h: 0,
    });
    expect(resolveDiagramCompositeRect(available, values)).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
    expect(
      resolveDiagramCompositeCoordinates(available, { ...values, w: 0, h: 0 }),
    ).toEqual({
      l: 47,
      ctrX: 47,
      r: 47,
      w: 0,
      t: 31,
      ctrY: 31,
      b: 31,
      h: 0,
    });
  });

  it("keeps inverted edge coordinates while exposing positive dimensions", () => {
    expect(
      resolveDiagramCompositeCoordinates(available, {
        l: 30,
        r: 10,
        t: 17,
        b: 5,
      }),
    ).toEqual({
      l: 30,
      ctrX: 20,
      r: 10,
      w: 20,
      t: 17,
      ctrY: 11,
      b: 5,
      h: 12,
    });
    expect(
      resolveDiagramCompositeCoordinates(available, {
        ctrX: 30,
        r: 10,
        ctrY: 17,
        b: 5,
      }),
    ).toEqual({
      l: 50,
      ctrX: 30,
      r: 10,
      w: 40,
      t: 29,
      ctrY: 17,
      b: 5,
      h: 24,
    });
  });

  it("overrides unused edges and centers when an explicit dimension wins", () => {
    expect(
      resolveDiagramCompositeCoordinates(available, {
        l: 20,
        ctrX: 40,
        r: 80,
        w: 30,
        t: 5,
        ctrY: 20,
        b: 40,
        h: 15,
      }),
    ).toEqual({
      l: 20,
      ctrX: 35,
      r: 50,
      w: 30,
      t: 5,
      ctrY: 12.5,
      b: 20,
      h: 15,
    });
  });

  it("normalizes an explicit negative size before computing all referenced coordinates", () => {
    expect(
      resolveDiagramCompositeCoordinates(available, {
        r: 50,
        w: -20,
        b: 35,
        h: -15,
      }),
    ).toEqual({
      l: 30,
      ctrX: 40,
      r: 50,
      w: 20,
      t: 20,
      ctrY: 27.5,
      b: 35,
      h: 15,
    });
  });

  it("derives values before group alignment, without quantizing dependent coordinates", () => {
    const values = { l: 1 / 7, w: 1 / 7, t: 1 / 13, h: 1 / 13 };
    const coordinates = resolveDiagramCompositeCoordinates(available, values);
    expect(coordinates.r).toBe(2 / 7);
    expect(coordinates.b).toBe(2 / 13);
    const before = structuredClone(coordinates);
    arrangeDiagramChildren(available, [rectangle(coordinates)], {
      type: "composite",
      aspectRatio: 0,
      horizontal: "ctr",
      vertical: "mid",
    });
    expect(coordinates).toEqual(before);
    expect(coordinates.r * 36000).not.toBe(Math.trunc(coordinates.r * 36000));
  });
});
