import { describe, expect, it } from "vitest";
import native from "./data/diagram-content-arrange-native.json";
import { arrangeDiagramChildren } from "../lib/pptx/src/internal/diagram/arrange.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { parseXml, NS } from "../lib/pptx/src/internal/xml/index.ts";
import { sample } from "./diagram-layout-fixture.js";

describe("DiagramML arrangement after child content fitting", () => {
  it.each(native.cases)("matches native fallback: $name", (row) => {
    const available = Object.freeze({ ...row.available });
    const children = Object.freeze(
      row.children.map((c) => Object.freeze({ ...c })),
    );
    const arrangement = Object.freeze({ ...row.arrangement });
    const result = arrangeDiagramChildren(available, children, arrangement, {
      childrenFit: row.childrenFit,
    });
    expect(result).toHaveLength(row.expected.length);
    for (const [i, child] of result.entries())
      for (const key of ["x", "y", "w", "h"])
        expect(
          Math.abs(Math.trunc(child[key] * 36000) - row.expected[i][key]),
          `${i}.${key}`,
        ).toBeLessThanOrEqual(1);
    expect(children).toEqual(row.children);
    expect(available).toEqual(row.available);
    expect(arrangement).toEqual(row.arrangement);
  });

  it("does not retain a failed attempt when a later child layout fits", () => {
    const available = { w: 100, h: 80 };
    const children = [{ x: 0, y: 0, w: 40, h: 20 }];
    const arrangement = {
      type: "lin",
      direction: "fromL",
      horizontal: "ctr",
      vertical: "mid",
    };
    const initial = arrangeDiagramChildren(available, children, arrangement);
    const failed = arrangeDiagramChildren(available, children, arrangement, {
      childrenFit: false,
    });
    expect(failed[0].w).toBeLessThan(initial[0].w);
    expect(failed[0].x + failed[0].w / 2).toBe(available.w / 2);
    expect(failed[0].y).toBe(initial[0].y);
    expect(
      arrangeDiagramChildren(available, children, arrangement, {
        childrenFit: true,
      }),
    ).toEqual(initial);
    expect(arrangeDiagramChildren(available, children, arrangement)).toEqual(
      initial,
    );
  });

  it.each(native.cases)(
    "coordinates native unruled content fallback: $name",
    (row) => {
      const a = row.arrangement;
      const layout = parseXml(
        `<d:layoutNode xmlns:d="${NS.diagram}"><d:alg type="${a.type}"><d:param type="horzAlign" val="${a.horizontal}"/><d:param type="vertAlign" val="${a.vertical}"/>${a.type === "lin" ? `<d:param type="linDir" val="${a.direction}"/>` : `<d:param type="ar" val="${a.aspectRatio}"/>`}</d:alg>${row.children
          .map(
            (rect, index) =>
              `<d:layoutNode name="child${index}"><d:alg type="tx"/><d:constrLst>${Object.entries(
                {
                  w: rect.w,
                  h: rect.h,
                  ...(a.type === "composite" ? { l: rect.x, t: rect.y } : {}),
                },
              )
                .map(
                  ([type, value]) =>
                    `<d:constr type="${type}" val="${value}"/>`,
                )
                .join("")}</d:constrLst></d:layoutNode>`,
          )
          .join("")}</d:layoutNode>`,
      );
      const root = expandDiagramLayout(layout.root, sample().tree);
      const result = reflowDiagramLayout(root, row.available, {
        textFits: () => row.childrenFit,
      });
      for (const [index, child] of root.children.entries())
        for (const key of ["x", "y", "w", "h"])
          expect(
            Math.abs(
              Math.trunc(result.bounds.get(child)[key] * 36000) -
                row.expected[index][key],
            ),
            `${index}.${key}`,
          ).toBeLessThanOrEqual(1);
    },
  );

  it("combines content and geometry failure in one search", () => {
    const available = { w: 19, h: 11 };
    const children = [
      { x: 0, y: 0, w: 60, h: 30 },
      { x: 0, y: 0, w: 17, h: 5 },
    ];
    for (const arrangement of [
      { type: "lin", direction: "fromB", horizontal: "r", vertical: "b" },
      {
        type: "composite",
        aspectRatio: 1.2,
        horizontal: "ctr",
        vertical: "mid",
      },
    ])
      expect(
        arrangeDiagramChildren(available, children, arrangement, {
          childrenFit: false,
        }),
      ).toEqual(arrangeDiagramChildren(available, children, arrangement));
  });
});
