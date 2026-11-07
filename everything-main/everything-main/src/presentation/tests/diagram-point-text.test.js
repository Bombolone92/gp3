import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import native from "./data/diagram-point-text-native.json";
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
import {
  NS,
  parseXml,
  textContent,
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
const measure = (row) => (shape, state, node) => {
  // Zero outer extents must bypass the measurement callback entirely. This
  // also protects against treating a sub-EMU extent or collapsed inset as zero.
  expect(state.size.w).not.toBe(0);
  expect(state.size.h).not.toBe(0);
  const key = JSON.stringify([
    node.name,
    P.getShapeText(shape),
    state.size.w,
    state.size.h,
    ...["primFontSz", "secFontSz", "lMarg", "rMarg", "tMarg", "bMarg"].map(
      (k) => state.values.get(k),
    ),
  ]);
  const m = row.measurements[key];
  if (!m) throw Error(`Unrecorded glyph measurement ${key}`);
  return !m.collapsed && m.wordFits && state.size.h >= m.requiredHeight;
};
const attributes = (e) =>
  e
    ? Object.fromEntries(
        e.attrs
          .filter((a) => !a.name.namespaceURI)
          .map((a) => [a.name.localName, a.value]),
      )
    : null;
const formatting = (shape) => {
  const body = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("", "txBody", NS.pml),
  );
  const paragraphs = (body?.children ?? [])
    .filter((e) => e.kind === "element" && e.name.localName === "p")
    .map((p) => {
      const pr = child(p, "pPr"),
        spacing = {};
      for (const name of ["lnSpc", "spcBef", "spcAft"]) {
        const e = child(pr, name)?.children.find((c) => c.kind === "element");
        if (e)
          spacing[name] = { type: e.name.localName, value: attr(e, "val") };
      }
      return {
        attributes: attributes(pr),
        spacing,
        bullet: child(pr, "buNone")
          ? "none"
          : attr(child(pr, "buChar"), "char"),
      };
    });
  return { body: attributes(child(body, "bodyPr")), paragraphs };
};
const draw = (frame, row) => {
  const result = reflowShapeDiagram(frame, { textFits: measure(row) }),
    drawing = buildDiagramDrawing(frame, result);
  const shapes = P.getGroupChildren(drawing.root).map((shape) => {
    const font = [];
    walkElements(shape[SHAPE_ELEMENT], (e) => {
      if (e.name.localName === "rPr") font.push(attr(e, "sz"));
    });
    return {
      ...formatting(shape),
      name: P.getShapeName(shape),
      text: P.getShapeText(shape),
      font,
      bounds: P.getShapeBounds(shape),
      textBounds: rect(drawing.information(shape)?.textTransform),
    };
  });
  return { result, shapes };
};
describe("point-sized SmartArt text", () => {
  it.each(native.cases)(
    "matches native geometry and independent text projection: $name",
    async (row) => {
      const { p, frame } = await semanticTextGroupDeck(row),
        before = unzipSync(await P.savePresentation(p)),
        { result, shapes } = draw(frame, row);
      expect(result.fits).toBe(row.fits);
      expect(shapes).toHaveLength(row.expected.length);
      for (const [i, shape] of shapes.entries()) {
        const expected = row.expected[i];
        for (const k of ["name", "text", "font"])
          expect(shape[k], `${i}.${k}`).toEqual(expected[k]);
        if (expected.body === null) expect(shape.body).toBeNull();
        else expect(shape.body).toMatchObject(expected.body);
        expect(shape.paragraphs).toHaveLength(expected.paragraphs.length);
        for (const [p, paragraph] of shape.paragraphs.entries())
          expect(paragraph).toMatchObject(expected.paragraphs[p]);
        for (const field of ["bounds", "textBounds"]) {
          if (expected[field] === null) expect(shape[field]).toBeNull();
          else
            for (const k of ["x", "y", "w", "h"]) {
              // Do not let the usual native EMU rounding tolerance mask zero
              // geometry becoming one EMU, or a zero text rectangle losing text.
              if ((k === "w" || k === "h") && expected[field][k] <= 1)
                expect(shape[field][k], `${i}.${field}.${k}`).toBe(
                  expected[field][k],
                );
              else
                expect(
                  Math.abs(shape[field][k] - expected[field][k]),
                  `${i}.${field}.${k}`,
                ).toBeLessThanOrEqual(1);
            }
        }
      }
      expect(draw(frame, row).shapes).toEqual(shapes);
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      const reopened = await P.loadPresentation(await P.savePresentation(p));
      expect(
        draw(
          P.getSlideShapes(P.getSlides(reopened)[0]).find(isDiagramShape),
          row,
        ).shapes,
      ).toEqual(shapes);
    },
  );
  it("retains point constraints and text after omitting its own drawing geometry", async () => {
    const row = native.cases.find((r) => r.name === "point-text / sp point");
    const { p, frame } = await semanticTextGroupDeck(row);
    const before = unzipSync(await P.savePresentation(p));
    const { result, shapes } = draw(frame, row);
    const query = [...result.bounds.keys()].find((n) => n.name === "query");
    expect(result.bounds.get(query)).toMatchObject({ w: 0, h: 0 });
    expect(result.drawing.get(query).values.get("primFontSz")).toBe(24);
    expect(result.drawing.get(query).values.get("lMarg")).toBe(3);
    expect(P.getShapeText(result.text.get(query))).toBe("Alpha");
    expect(shapes.map((s) => s.name)).toEqual(["geometry"]);
    expect(shapes[0].textBounds).toEqual({ x: 0, y: 0, w: 914400, h: 914400 });
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
  });
});

it.each(
  ["svg", "foreignObject"].flatMap((mode) =>
    ["point-text / sp second-first", "point-holdout / custom true mixed"].map(
      (name) => ({ mode, name }),
    ),
  ),
)(
  "preserves point-supplied text through $mode rendering and bidirectional copy/export: $name",
  async ({ mode, name }) => {
    const row = native.cases.find((r) => r.name === name),
      { p, frame } = await semanticTextGroupDeck(row),
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
          target: "https://example.org/point-text",
          targetMode: "External",
        },
      ],
    });
    const render = (pres, slide = P.getSlides(pres)[0]) =>
        renderSlideToSvg(pres, slide, {
          textLayout: mode,
          stableDefinitionIds: true,
        }),
      before = unzipSync(await P.savePresentation(p)),
      expected = draw(frame, row).shapes,
      svg = render(p);
    expect(svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(svg).not.toContain("data-pptx-diagram-issues");
    expect(textContent(parseXml(svg).root)).toContain("Alpha");
    expect(svg).toContain("https://example.org/point-text");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    const local = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
    expect(draw(P.copyShape(local, frame), row).shapes).toEqual(expected);
    const target = createDeck("blank"),
      blank = P.getSlides(target)[0];
    P.importSlide(target, local, P.getSlideLayouts(target)[0]);
    P.removeSlide(target, blank);
    const transferred = render(target),
      reopened = await P.loadPresentation(await P.savePresentation(target));
    expect(render(reopened)).toBe(transferred);
    expect(transferred).toContain("https://example.org/point-text");
    expect(
      draw(P.getSlideShapes(P.getSlides(reopened)[0]).find(isDiagramShape), row)
        .shapes,
    ).toEqual(expected);
    const returned = P.importSlide(
      p,
      P.getSlides(reopened)[0],
      P.getSlideLayouts(p)[0],
    );
    expect(
      draw(P.getSlideShapes(returned).find(isDiagramShape), row).shapes,
    ).toEqual(expected);
    expect(render(p, returned)).toContain("https://example.org/point-text");
  },
);
