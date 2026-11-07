import { describe, expect, it } from "vitest";
import {
  arrangeDiagramChildren,
  positionDiagramLinearChildren,
} from "../lib/pptx/src/internal/diagram/arrange.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
import {
  NS,
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { sample } from "./diagram-layout-fixture.js";
import { diagramSpacerDeck } from "./diagram-spacer-fixture.js";
import { P, createDeck, preview } from "../src/model.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";

const directions = ["fromL", "fromR", "fromT", "fromB"];
const horizontal = (direction) =>
  direction === "fromL" || direction === "fromR";
const rect = (direction, advance, cross = 10) =>
  horizontal(direction)
    ? { x: 0, y: 0, w: advance, h: cross }
    : { x: 0, y: 0, w: cross, h: advance };
const arrangement = (direction, align = false) => ({
  type: "lin",
  direction,
  horizontal: align ? "ctr" : "none",
  vertical: align ? "mid" : "none",
});

describe("signed DiagramML space advances", () => {
  it.each(directions)(
    "overlaps siblings along %s without normalizing the advance",
    (direction) => {
      const children = [
        rect(direction, 30),
        rect(direction, -8, 0),
        rect(direction, 20),
      ];
      const before = structuredClone(children),
        available = rect(direction, 100, 50),
        axis = horizontal(direction) ? "x" : "y",
        main = horizontal(direction) ? "w" : "h",
        spacers = new Set([1]),
        forward = direction === "fromL" || direction === "fromT";
      const expected = forward ? [0, 30, 22] : [12, 20, 0];
      for (const place of [
        arrangeDiagramChildren,
        positionDiagramLinearChildren,
      ]) {
        const result = place(available, children, arrangement(direction), {
          spacers,
        });
        expect(result.map((r) => r[axis])).toEqual(expected);
        expect(result.map((r) => r[main])).toEqual([30, -8, 20]);
        const centered = place(
          available,
          children,
          arrangement(direction, true),
          { spacers },
        );
        expect(centered.map((r) => r[axis])).toEqual(
          expected.map((v) => v + 29),
        );
      }
      expect(children).toEqual(before);
      expect(spacers).toEqual(new Set([1]));
    },
  );

  it.each(directions)(
    "fits signed spacing and retains its proportion along %s",
    (direction) => {
      const children = [
          rect(direction, 80),
          rect(direction, -20, 0),
          rect(direction, 60),
        ],
        main = horizontal(direction) ? "w" : "h",
        result = arrangeDiagramChildren(
          rect(direction, 30, 20),
          children,
          arrangement(direction),
          { spacers: new Set([1]) },
        );
      // The whole occupied range is 120, so the existing binary LIN search fits
      // at exactly 1/4. A cap using Math.min must not restore the negative -20.
      expect(result.map((r) => r[main])).toEqual([20, -5, 15]);
    },
  );

  it.each(directions)(
    "fits the traversal envelope when %s backtracks beyond its ends",
    (direction) => {
      const main = horizontal(direction) ? "w" : "h",
        axis = horizontal(direction) ? "x" : "y";
      for (const advances of [
        [-20, 10],
        [10, -20],
        [-20, -10],
        [10, -30, 10],
      ]) {
        const children = advances.map((a) => rect(direction, a, 0)),
          spacers = new Set(advances.flatMap((a, i) => (a < 0 ? [i] : []))),
          result = arrangeDiagramChildren(
            rect(direction, 5, 20),
            children,
            arrangement(direction, true),
            { spacers },
          );
        const ends = result.flatMap((r) => [r[axis], r[axis] + r[main]]),
          first = Math.min(...ends),
          last = Math.max(...ends);
        expect(last - first).toBeLessThanOrEqual(5);
        expect((first + last) / 2).toBeCloseTo(2.5, 12);
        result.forEach((r, i) =>
          expect(Math.sign(r[main])).toBe(Math.sign(advances[i])),
        );
      }
    },
  );

  it("still rejects negative shapes, cross dimensions, canvases and non-finite advances", () => {
    const available = { w: 100, h: 50 },
      spacers = new Set([0]);
    for (const direction of directions) {
      expect(() =>
        arrangeDiagramChildren(
          available,
          [rect(direction, -1)],
          arrangement(direction),
        ),
      ).toThrow("negative diagram layout size");
      expect(() =>
        arrangeDiagramChildren(
          available,
          [rect(direction, -1, -1)],
          arrangement(direction),
          { spacers },
        ),
      ).toThrow("negative diagram layout size");
      for (const value of [NaN, Infinity, -Infinity])
        expect(() =>
          arrangeDiagramChildren(
            available,
            [rect(direction, value)],
            arrangement(direction),
            { spacers },
          ),
        ).toThrow("non-finite");
      expect(() =>
        arrangeDiagramChildren({ w: -1, h: 50 }, [], arrangement(direction), {
          spacers,
        }),
      ).toThrow("negative diagram layout size");
    }
    expect(() =>
      arrangeDiagramChildren(
        available,
        [{ x: 0, y: 0, w: -1, h: 0 }],
        {
          type: "composite",
          aspectRatio: 0,
          horizontal: "ctr",
          vertical: "mid",
        },
        { spacers },
      ),
    ).toThrow("negative diagram layout size");
  });

  it.each(directions)(
    "reflows and resizes non-drawing SP allocations under %s",
    (direction) => {
      const main = horizontal(direction) ? "w" : "h",
        other = horizontal(direction) ? "h" : "w",
        content = [80, -20, 60]
          .map(
            (value, i) =>
              `<d:layoutNode name="child${i}"><d:alg type="${i === 1 ? "sp" : "tx"}"/>${i === 1 ? '<d:shape type="none"/>' : '<d:shape type="rect"/>'}<d:constrLst><d:constr type="${main}" val="${value}"/><d:constr type="${other}" val="${i === 1 ? 0 : 10}"/></d:constrLst></d:layoutNode>`,
          )
          .join(""),
        root = expandDiagramLayout(
          parseXml(
            `<d:layoutNode xmlns:d="${NS.diagram}"><d:alg type="lin"><d:param type="linDir" val="${direction}"/><d:param type="horzAlign" val="none"/><d:param type="vertAlign" val="none"/></d:alg>${content}</d:layoutNode>`,
          ).root,
          sample().tree,
        ),
        before = serializeFragment(root.definition),
        result = reflowDiagramLayout(root, rect(direction, 30, 20), {
          textFits: () => true,
        });
      expect(result.fits).toBe(true);
      expect(result.bounds.get(root)[main]).toBe(30);
      expect(root.children.map((n) => result.bounds.get(n)[main])).toEqual([
        20, -5, 15,
      ]);
      expect(result.allocation.get(root.children[1]).size[main]).toBe(-5);
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );

  it.each(["fromL", "fromR"])(
    "retains signed allocations while nested text height rules fit under %s",
    (direction) => {
      const box = (name) =>
        `<d:layoutNode name="${name}"><d:alg type="tx"/><d:shape type="rect"/><d:constrLst><d:constr type="w" val="60"/><d:constr type="h" val="1"/></d:constrLst><d:ruleLst><d:rule type="h" val="14"/></d:ruleLst></d:layoutNode>`;
      const root = expandDiagramLayout(
          parseXml(
            `<d:layoutNode xmlns:d="${NS.diagram}"><d:alg type="composite"/><d:layoutNode name="row"><d:alg type="lin"><d:param type="linDir" val="${direction}"/></d:alg>${box("first")}<d:layoutNode name="gap"><d:alg type="sp"/><d:constrLst><d:constr type="w" val="-20"/></d:constrLst></d:layoutNode>${box("last")}</d:layoutNode></d:layoutNode>`,
          ).root,
          sample().tree,
        ),
        before = serializeFragment(root.definition),
        result = reflowDiagramLayout(
          root,
          { w: 40, h: 20 },
          {
            textFits: (_node, state) => state.size.h >= 5 && state.size.w >= 10,
          },
        ),
        [first, gap, last] = root.children[0].children;
      expect(result.fits).toBe(true);
      expect(result.bounds.get(gap).w).toBeLessThan(0);
      expect(result.bounds.get(gap).w / result.bounds.get(first).w).toBeCloseTo(
        -1 / 3,
        12,
      );
      expect(result.bounds.get(last).w).toBe(result.bounds.get(first).w);
      for (const n of [first, last])
        expect(result.drawing.get(n).size.h).toBeGreaterThanOrEqual(5);
      expect(result.bounds.get(root).w).toBeLessThanOrEqual(40);
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );

  it.each(["", "<d:shape/>", '<d:shape type="none"/>'])(
    "accepts the no-output SP form %s",
    (shape) => {
      const root = expandDiagramLayout(
          parseXml(
            `<d:layoutNode xmlns:d="${NS.diagram}"><d:alg type="lin"/><d:layoutNode><d:alg type="sp"/>${shape}<d:constrLst><d:constr type="w" val="-20"/></d:constrLst></d:layoutNode></d:layoutNode>`,
          ).root,
          sample().tree,
        ),
        result = reflowDiagramLayout(
          root,
          { w: 10, h: 10 },
          { textFits: () => true },
        );
      expect(result.bounds.get(root).w).toBe(10);
      expect(result.bounds.get(root.children[0]).w).toBe(-10);
    },
  );

  it("does not infer a spacer from hidden geometry or a painted SP node", () => {
    for (const shape of [
      '<d:shape type="rect"/>',
      '<d:shape type="rect" hideGeom="true"/>',
    ]) {
      const root = expandDiagramLayout(
        parseXml(
          `<d:layoutNode xmlns:d="${NS.diagram}"><d:alg type="lin"/><d:layoutNode><d:alg type="sp"/>${shape}<d:constrLst><d:constr type="w" val="-20"/></d:constrLst></d:layoutNode></d:layoutNode>`,
        ).root,
        sample().tree,
      );
      expect(() =>
        reflowDiagramLayout(root, { w: 10, h: 10 }, { textFits: () => true }),
      ).toThrow("negative diagram layout size");
    }
  });

  it.each(directions)(
    "renders and preserves semantic signed spacing through export and two-way copy: %s",
    async (direction) => {
      const { p, frame, diagram } = await diagramSpacerDeck({ direction }),
        original = diagram.layout.part.data.slice(),
        result = reflowShapeDiagram(frame, { textFits: () => true }),
        main = horizontal(direction) ? "w" : "h";
      expect(
        result.root.children.map((n) => result.bounds.get(n)[main]),
      ).toEqual([34, -12, 34, -12, 34]);
      const render = (p, slide) =>
        decodeURIComponent(preview(p, slide).split(",").slice(1).join(","));
      const source = render(p, P.getSlides(p)[0]);
      expect(source).toContain('data-pptx-diagram="semantic-layout"');
      expect(source).not.toContain("data-pptx-diagram-issues");
      expect(source).toContain("#1B52C1");
      for (const text of ["West", "Central", "East"])
        expect(source).toContain(text);
      const target = createDeck("blank"),
        slide = P.importSlide(
          target,
          P.getSlides(p)[0],
          P.getSlideLayouts(target)[0],
        ),
        copied = P.getSlideShapes(slide)[0],
        reopened = await P.loadPresentation(await P.savePresentation(target)),
        returnedSlide = P.importSlide(p, slide, P.getSlideLayouts(p)[0]),
        returned = P.getSlideShapes(returnedSlide)[0],
        duplicated = P.copyShape(returnedSlide, returned);
      expect(P.validatePresentation(target)).toEqual([]);
      expect(P.validatePresentation(reopened)).toEqual([]);
      expect(readShapeDiagram(copied).layout.part.data).toEqual(original);
      expect(readShapeDiagram(returned).layout.part.data).toEqual(original);
      expect(readShapeDiagram(duplicated).layout.part.data).toEqual(original);
      expect(render(target, slide)).toBe(source);
      expect(render(reopened, P.getSlides(reopened)[1])).toBe(source);
      expect(diagram.layout.part.data).toEqual(original);
    },
  );
});
