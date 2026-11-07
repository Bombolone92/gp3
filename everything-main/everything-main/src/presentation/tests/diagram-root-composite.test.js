import { expect, it } from "vitest";
import {
  NS,
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";

const rootLayout = (rectangles, centered = false) =>
  expandDiagramLayout(
    parseXml(`<d:layoutNode xmlns:d="${NS.diagram}" name="root">
      <d:alg type="composite"><d:param type="horzAlign" val="${centered ? "ctr" : "none"}"/><d:param type="vertAlign" val="${centered ? "mid" : "none"}"/></d:alg>
      <d:shape type="rect"/>
      <d:constrLst>${rectangles
        .map((r, i) =>
          Object.entries(r)
            .map(
              ([type, val]) =>
                `<d:constr type="${type}" for="ch" forName="child${i}" val="${val}"/>`,
            )
            .join(""),
        )
        .join("")}</d:constrLst>
      ${rectangles.map((_, i) => `<d:layoutNode name="child${i}"><d:alg type="sp"/><d:shape type="rect"/></d:layoutNode>`).join("")}
    </d:layoutNode>`).root,
    sample().tree,
  );

it.each([
  {
    centered: false,
    expected: [
      { x: 5, y: 7, w: 39, h: 18 },
      { x: 5, y: 7, w: 10, h: 12 },
      { x: 40, y: 15, w: 4, h: 10 },
    ],
  },
  {
    centered: true,
    expected: [
      { x: 30.5, y: 31, w: 39, h: 18 },
      { x: 30.5, y: 31, w: 10, h: 12 },
      { x: 65.5, y: 39, w: 4, h: 10 },
    ],
  },
])(
  "draws a composite root around separated children while retaining canvas alignment: $centered",
  ({ centered, expected }) => {
    const root = rootLayout(
        [
          { l: 5, t: 7, w: 10, h: 12 },
          { l: 40, t: 15, w: 4, h: 10 },
        ],
        centered,
      ),
      before = serializeFragment(root.definition),
      available = { w: 100, h: 80 },
      result = reflowDiagramLayout(root, available, { textFits: () => true });
    expect([...result.bounds.values()]).toEqual(expected);
    expect(result.allocation.get(root).size).toEqual(available);
    expect(result.drawing.get(root).size).toEqual(available);
    expect(serializeFragment(root.definition)).toBe(before);
  },
);

it("preserves negative child coordinates in an unbounded composite root", () => {
  const root = rootLayout([
      { l: -8, t: -5, w: 12, h: 9 },
      { l: 20, t: 4, w: 6, h: 3 },
    ]),
    result = reflowDiagramLayout(
      root,
      { w: 0, h: 0 },
      { textFits: () => true },
    );
  expect([...result.bounds.values()]).toEqual([
    { x: -8, y: -5, w: 34, h: 12 },
    { x: -8, y: -5, w: 12, h: 9 },
    { x: 20, y: 4, w: 6, h: 3 },
  ]);
  expect(result.allocation.get(root).size).toEqual({ w: 0, h: 0 });
});

it("keeps an empty root's canvas but excludes zero-area children from its drawing", () => {
  const empty = rootLayout([]),
    points = rootLayout([{ l: 5, t: 7, w: 0, h: 0 }]),
    available = { w: 100, h: 80 };
  expect(
    reflowDiagramLayout(empty, available, { textFits: () => true }).bounds.get(
      empty,
    ),
  ).toEqual({ x: 0, y: 0, ...available });
  const result = reflowDiagramLayout(points, available, {
    textFits: () => true,
  });
  expect(result.bounds.get(points)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  expect(result.bounds.get(points.children[0])).toEqual({
    x: 5,
    y: 7,
    w: 0,
    h: 0,
  });
});
