import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import native from "./data/diagram-drawing-text-native.json";
import { P, createDeck } from "../src/model.js";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";
import {
  readShapeDiagram,
  isDiagramShape,
} from "../lib/pptx/src/api/fn/diagram-read.ts";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import {
  NS,
  getAttrValue,
  qname,
  firstChildElement,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => e && getAttrValue(e, qname("", n, ""));
const child = (e, n) => e && firstChildElement(e, qname("", n, NS.dml));
const rect = (e) =>
  e
    ? {
        x: Number(attr(child(e, "off"), "x")),
        y: Number(attr(child(e, "off"), "y")),
        w: Number(attr(child(e, "ext"), "cx")),
        h: Number(attr(child(e, "ext"), "cy")),
      }
    : null;
const draw = (frame) => {
  const result = reflowShapeDiagram(frame, { textFits: () => true });
  const d = buildDiagramDrawing(frame, result);
  return P.getGroupChildren(d.root).map((shape) => {
    const font = [];
    walkElements(shape[SHAPE_ELEMENT], (e) => {
      if (e.name.localName === "rPr") font.push(attr(e, "sz"));
    });
    return {
      name: P.getShapeName(shape),
      text: P.getShapeText(shape),
      font,
      bounds: P.getShapeBounds(shape),
      textBounds: rect(d.information(shape)?.textTransform),
    };
  });
};
const render = (p, mode) =>
  renderSlideToSvg(p, P.getSlides(p)[0], {
    textLayout: mode,
    stableDefinitionIds: true,
  });
describe("SmartArt geometry and text associations", () => {
  it.each(native.cases)(
    "matches native text suppliers and independent rectangles: $name",
    async (row) => {
      const { p, frame } = await semanticTextGroupDeck(row),
        before = unzipSync(await P.savePresentation(p));
      const actual = draw(frame);
      expect(actual).toHaveLength(row.expected.length);
      for (const [i, shape] of actual.entries()) {
        const expected = row.expected[i];
        for (const key of ["name", "text", "font"])
          expect(shape[key], `${i}.${key}`).toEqual(expected[key]);
        for (const field of ["bounds", "textBounds"]) {
          if (expected[field] === null) expect(shape[field]).toBeNull();
          else
            for (const key of ["x", "y", "w", "h"])
              expect(
                Math.abs(shape[field][key] - expected[field][key]),
                `${i}.${field}.${key}`,
              ).toBeLessThanOrEqual(1);
        }
      }
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      const reopened = await P.loadPresentation(await P.savePresentation(p));
      expect(
        draw(P.getSlideShapes(P.getSlides(reopened)[0]).find(isDiagramShape)),
      ).toEqual(actual);
    },
  );
  it.each(
    ["svg", "foreignObject"].flatMap((mode) =>
      [false, true].map((unbounded) => ({ mode, unbounded })),
    ),
  )(
    "retains associated text through $mode rendering and cross-deck copy (unbounded: $unbounded)",
    async ({ mode, unbounded }) => {
      const row = native.cases.find(
        (r) =>
          r.name === `${unbounded ? "unbounded " : ""}sp sibling hidden text`,
      );
      const { p, frame } = await semanticTextGroupDeck(row),
        d = readShapeDiagram(frame),
        pkg = P._internalPackageOf(p);
      d.data.part.data = new TextEncoder().encode(
        row.data.replace(
          '<a:latin typeface="Arial"/>',
          `<a:latin typeface="Arial"/><a:hlinkClick xmlns:r="${NS.officeDocRels}" r:id="visit"/>`,
        ),
      );
      pkg.setRels(d.data.part.name, {
        items: [
          {
            id: "visit",
            type: REL_TYPES.hyperlink,
            target: "https://example.org/associated-text",
            targetMode: "External",
          },
        ],
      });
      const before = unzipSync(await P.savePresentation(p)),
        svg = render(p, mode),
        expected = draw(frame);
      expect(svg).toContain('data-pptx-diagram="semantic-layout"');
      expect(svg).not.toContain("data-pptx-diagram-issues");
      expect(svg).toContain("Alpha");
      expect(svg).toContain("https://example.org/associated-text");
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      const localSlide = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
      expect(draw(P.copyShape(localSlide, frame))).toEqual(expected);
      const destination = createDeck("blank"),
        blank = P.getSlides(destination)[0];
      P.importSlide(destination, localSlide, P.getSlideLayouts(destination)[0]);
      P.removeSlide(destination, blank);
      const transferred = render(destination, mode);
      expect(transferred).toContain("Alpha");
      expect(transferred).toContain("https://example.org/associated-text");
      expect(transferred).not.toContain("data-pptx-diagram-issues");
      const reopened = await P.loadPresentation(
        await P.savePresentation(destination),
      );
      const copied = P.getSlideShapes(P.getSlides(reopened)[0]).find(
        isDiagramShape,
      );
      expect(draw(copied)).toEqual(expected);
      expect(render(reopened, mode)).toBe(transferred);
      const returned = createDeck("blank"),
        initialSlide = P.getSlides(returned)[0];
      P.importSlide(
        returned,
        P.getSlides(reopened)[0],
        P.getSlideLayouts(returned)[0],
      );
      P.removeSlide(returned, initialSlide);
      expect(render(returned, mode)).toBe(transferred);
    },
  );
});
