import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartPlotGuidesDeck,
  guideLineModes,
} from "./chart-plot-guides-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const gradient = (angle, scaled) =>
  `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="8F2D73"/></a:gs><a:gs pos="100000"><a:srgbClr val="16827C"/></a:gs></a:gsLst><a:lin ang="${angle * 60000}" scaled="${scaled ? 1 : 0}"/></a:gradFill>`;
function fixture({ role, cap, join, widthPt, angle, scaled, ...options }) {
  guideLineModes.reference = `<a:ln w="${widthPt * 12700}" cap="${cap}">${gradient(angle, scaled)}<a:${join}/></a:ln>`;
  try {
    return chartPlotGuidesDeck({
      groups: [{ kind: "line", [role]: "reference" }],
      valueAxisCrossBetween: "between",
      categoryAxisCrosses: { at: 5 },
      lines: {
        category: "<a:ln><a:noFill/></a:ln>",
        value: "<a:ln><a:noFill/></a:ln>",
      },
      grids: {
        category: "<a:ln><a:noFill/></a:ln>",
        value: "<a:ln><a:noFill/></a:ln>",
      },
      ...options,
    });
  } finally {
    delete guideLineModes.reference;
  }
}
function paint(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    elements = [];
  walkElements(parseXml(svg).root, (e) => elements.push(e));
  const definitions = new Map(
    elements.filter((e) => attr(e, "id")).map((e) => [attr(e, "id"), e]),
  );
  return elements
    .filter(
      (e) =>
        e.name.localName === "line" && attr(e, "stroke")?.startsWith("url("),
    )
    .map((line) => {
      const server = definitions.get(attr(line, "stroke").slice(5, -1));
      const definition =
        server.name.localName === "pattern"
          ? definitions.get(
              attr(
                server.children.find(
                  (e) => e.kind === "element" && e.name.localName === "rect",
                ),
                "fill",
              ).slice(5, -1),
            )
          : server;
      expect(definition.name.localName).toBe("linearGradient");
      return { line, definition, server };
    });
}
// Native reference controls: 67 pages / 268 paths, 4,020 sampled shading
// positions. Pen-relative bounds are independent of chart size, scale and data.
// These factors describe native bounds, not the SVG stroke's painted extents.
const nativeBounds = [
  ["flat", "round", 1, 0, 0.5],
  ["flat", "bevel", 1, 0, 0],
  ["flat", "miter", 1, 0, 0.5],
  ["rnd", "round", 1, 0.5, 0.5],
  ["rnd", "bevel", 1, 0.5, 0.5],
  ["rnd", "miter", 1, 0.5, 0.5],
  ["sq", "round", Math.SQRT2, Math.SQRT1_2, Math.SQRT1_2],
  ["sq", "bevel", Math.SQRT2, Math.SQRT1_2, Math.SQRT1_2],
  ["sq", "miter", Math.SQRT2, Math.SQRT1_2, Math.SQRT1_2],
];
function progress(definition, server, X, Y) {
  const transform = attr(definition, "gradientTransform")
      .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)
      .map(Number),
    [x, y, w, h] =
      server.name.localName === "pattern"
        ? [
            ...attr(server, "patternTransform")
              .match(/-?\d+(?:\.\d+)?/g)
              .map(Number),
            ...transform,
          ]
        : transform,
    [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((n) =>
      Number(attr(definition, n)),
    ),
    dx = x2 - x1,
    dy = y2 - y1;
  return (
    (((X - x) / w - x1) * dx + ((Y - y) / h - y1) * dy) / (dx * dx + dy * dy)
  );
}

describe("native guide gradient paint bounds", () => {
  for (const role of ["dropLines", "hiLowLines"])
    for (const [cap, join, widthFactor, startFactor, endFactor] of nativeBounds)
      for (const angle of [0, 30, 90, 135, 270])
        for (const scaled of [false, true])
          it(`${role} ${cap}/${join} ${angle}° scaled=${scaled} paints each path independently`, () => {
            for (const widthPt of [2, 8]) {
              const f = fixture({ role, cap, join, angle, scaled, widthPt }),
                strokes = paint(f);
              expect(strokes).toHaveLength(4);
              expect(
                new Set(strokes.map(({ definition }) => attr(definition, "id")))
                  .size,
              ).toBe(4);
              for (const { line, definition, server } of strokes) {
                const [x, y1, y2, width] = [
                    "x1",
                    "y1",
                    "y2",
                    "stroke-width",
                  ].map((n) => Number(attr(line, n))),
                  w = width * widthFactor,
                  h = y2 - y1 + width * (startFactor + endFactor),
                  cx = x,
                  cy = (y1 - width * startFactor + y2 + width * endFactor) / 2,
                  radians = (angle * Math.PI) / 180,
                  nx = Math.cos(radians) / (scaled ? w : 1),
                  ny = Math.sin(radians) / (scaled ? h : 1),
                  span = Math.abs(nx) * w + Math.abs(ny) * h;
                expect(attr(definition, "gradientUnits")).toBe(
                  "userSpaceOnUse",
                );
                for (const u of [-0.25, 0, 0.25])
                  for (const v of [0.1, 0.5, 0.9]) {
                    const X = x + u * width,
                      Y = y1 + (y2 - y1) * v,
                      expected = 0.5 + ((X - cx) * nx + (Y - cy) * ny) / span;
                    expect(progress(definition, server, X, Y)).toBeCloseTo(
                      expected,
                      2, // SVG path and paint frames serialize to 0.01 pixels.
                    );
                  }
              }
            }
          });
  it("retains independent gradients through transferred edits and reload without changing source parts", async () => {
    const f = fixture({
        role: "dropLines",
        cap: "sq",
        join: "bevel",
        widthPt: 8,
        angle: 30,
        scaled: true,
      }),
      part = f.part.data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      before = preview(f.p, f.slide),
      p = createDeck("blank"),
      slide = P.importSlide(p, f.slide, P.getSlideLayouts(p)[0]),
      chart = P.getSlideCharts(slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      textStyle: { font: "Arial", sizePt: 13 },
      series: chart.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => (v === null ? v : v + 2)),
      })),
    });
    const copied = { p, slide };
    expect(paint(copied)).toHaveLength(4);
    const saved = await P.loadPresentation(await P.savePresentation(p));
    expect(preview(saved, P.getSlides(saved).at(-1))).toEqual(
      preview(p, slide),
    );
    const returned = P.importSlide(f.p, slide, P.getSlideLayouts(f.p)[0]);
    expect(paint({ p: f.p, slide: returned })).toHaveLength(4);
    expect(f.part.data).toEqual(part);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      part,
    );
    expect(workbook(f.p, f.shape).data).toEqual(book);
    expect(preview(f.p, f.slide)).toEqual(before);
  });
});
