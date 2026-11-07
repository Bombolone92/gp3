import { it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartSeriesClippingDeck,
  chartXYClippingDeck,
  clippingColors as C,
} from "./chart-series-clipping-fixture.js";
import {
  parseXml,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const box = (e) =>
  Object.fromEntries(
    ["x", "y", "width", "height"].map((n) => [n, Number(attr(e, n))]),
  );
function paint(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    nodes = [];
  const visit = (e, clips = []) => {
    const own = attr(e, "clip-path");
    if (own) clips = [...clips, own];
    nodes.push({ e, clips });
    for (const c of e.children) if (c.kind === "element") visit(c, clips);
  };
  visit(parseXml(svg).root);
  const clipBox = (ref) => {
    const id = ref.match(/^url\(#(.+)\)$/)?.[1],
      node = nodes.find(
        ({ e }) => e.name.localName === "clipPath" && attr(e, "id") === id,
      )?.e;
    expect(node, `resolved clipping definition ${ref}`).toBeDefined();
    expect(attr(node, "clipPathUnits")).toBe("userSpaceOnUse");
    return box(node.children.find((e) => e.kind === "element"));
  };
  return { svg, nodes, clipBox };
}
// Plots clip paint, not vertices: clamping data changes the closed
// outline, interpolation, paint bounds, and portions entering the plot.
for (const kind of ["bar", "column", "line", "area"])
  for (const direction of ["minMax", "maxMin"])
    for (const grouping of ["clustered", "stacked", "percentStacked"])
      for (const crossBetween of ["between", "midCat"])
        it(`${kind} ${direction} ${grouping} ${crossBetween} clips bodies independently of markers and labels`, () => {
          const f = chartSeriesClippingDeck({
              kind,
              direction,
              grouping,
              crossBetween,
            }),
            r = paint(f),
            plot = box(
              r.nodes.find(
                ({ e }) =>
                  e.name.localName === "rect" && attr(e, "fill") === C.plot,
              ).e,
            ),
            bodies = r.nodes.filter(
              ({ e }) =>
                ["path", "rect"].includes(e.name.localName) &&
                (e.name.localName !== "rect" ||
                  Number(attr(e, "width")) > 20 ||
                  Number(attr(e, "height")) > 20) &&
                [C.series, C.outline].some(
                  (c) => attr(e, "fill") === c || attr(e, "stroke") === c,
                ),
            );
          expect(bodies.length).toBeGreaterThan(0);
          for (const body of bodies) {
            expect(body.clips).toHaveLength(1);
            expect(r.clipBox(body.clips[0])).toEqual(plot);
          }
          const labels = r.nodes.filter(
            ({ e }) =>
              e.name.localName === "text" && attr(e, "fill") === C.labels,
          );
          expect(labels.length).toBeGreaterThanOrEqual(5);
          expect(labels.every(({ clips }) => !clips.length)).toBe(true);
          const markers = r.nodes.filter(
            ({ e }) =>
              e.name.localName === "circle" &&
              attr(e, "fill") === C.marker &&
              Number(attr(e, "r")) > 5,
          );
          expect(markers).toHaveLength(
            kind === "line" ? (grouping === "percentStacked" ? 5 : 3) : 0,
          );
          for (const marker of markers) {
            expect(marker.clips).toHaveLength(1);
            const frame = r.clipBox(marker.clips[0]);
            expect(frame.width).toBeGreaterThan(plot.width);
            expect(frame.height).toBeGreaterThan(plot.height);
          }
          if (kind === "line") {
            const path = bodies.find(
                ({ e }) => attr(e, "stroke") === C.outline,
              ).e,
              coords = [
                ...attr(path, "d").matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g),
              ].map((m) => [+m[1], +m[2]]);
            expect(coords).toHaveLength(5);
            expect(coords.some(([, y]) => y < plot.y)).toBe(
              grouping !== "percentStacked",
            );
            expect(coords.some(([, y]) => y > plot.y + plot.height)).toBe(
              grouping !== "percentStacked",
            );
          }
        });

for (const direction of ["minMax", "maxMin"])
  for (const size of [14, 72])
    it(`scatter ${direction} ${size} culls centers outside either numeric axis while preserving line vertices`, () => {
      const r = paint(chartXYClippingDeck({ direction, size })),
        lines = r.nodes.filter(
          ({ e }) =>
            e.name.localName === "path" &&
            attr(e, "fill") === "none" &&
            ["#E85239", "#2F8541", "#376CA8"].includes(attr(e, "stroke")),
        ),
        points = r.nodes.filter(
          ({ e }) =>
            ["circle", "rect", "polygon"].includes(e.name.localName) &&
            ["#116699", "#D9B231", "#CC3344"].some(
              (c) => attr(e, "fill") === c || attr(e, "stroke") === c,
            ),
        );
      expect(lines).toHaveLength(3);
      for (const { e, clips } of lines) {
        expect(attr(e, "d").match(/[ML]/g)).toHaveLength(3);
        expect(clips).toHaveLength(1);
      }
      // One in-range point per series; legend glyphs are deliberately excluded.
      const plotted = points.filter(({ clips }) => clips.length);
      expect(plotted).toHaveLength(3);
      for (const { clips } of plotted) {
        expect(clips).toHaveLength(1);
        expect(r.clipBox(clips[0]).width).toBeGreaterThan(
          r.clipBox(lines[0].clips[0]).width,
        );
      }
    });

for (const direction of ["minMax", "maxMin"])
  it(`bubble ${direction} retains out-of-domain centers and clips circles to the plot`, () => {
    const r = paint(chartXYClippingDeck({ kind: "bubble", direction })),
      points = r.nodes.filter(
        ({ e }) =>
          e.name.localName === "circle" &&
          ["#E85239", "#2F8541", "#376CA8"].includes(attr(e, "fill")) &&
          Number(attr(e, "r")) > 10,
      );
    expect(points).toHaveLength(9);
    for (const { e, clips } of points) {
      expect(clips).toHaveLength(1);
      const p = r.clipBox(clips[0]);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(Number(attr(e, "r"))).toBeGreaterThan(10);
    }
  });

for (const kind of ["column", "bar", "line", "area", "scatter", "bubble"])
  it(`${kind} clipping preserves native data, workbook and editability through transfer and save`, async () => {
    const f = ["scatter", "bubble"].includes(kind)
        ? chartXYClippingDeck({ kind })
        : chartSeriesClippingDeck({ kind }),
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      spec = P.getShapeChartSpec(f.shape),
      q = createDeck("blank"),
      slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      saved = await P.loadPresentation(await P.savePresentation(q)),
      imported = P.getSlides(saved).at(-1),
      chart = P.getSlideCharts(imported)[0];
    expect(P.getShapeChartSpec(chart.shape)).toEqual(spec);
    expect(
      P._internalPackageOf(saved).getPart(chartRoot(chart.shape)).data,
    ).toEqual(raw);
    expect(workbook(saved, chart.shape).data).toEqual(book);
    const back = P.importSlide(f.p, imported, P.getSlideLayout(f.slide));
    expect(preview(f.p, back)).toBe(preview(f.p, f.slide));
    expect(P.validatePresentation(saved)).toEqual([]);
    expect(P.validatePresentation(f.p)).toEqual([]);
    expect(P.getSlideCharts(slide)).toHaveLength(1);
  });

for (const direction of ["minMax", "maxMin"])
  it(`secondary ${direction} line clips its own cumulative domain without inheriting column paint clipping`, () => {
    const r = paint(chartSeriesClippingDeck({ direction, secondary: true })),
      markers = r.nodes.filter(
        ({ e, clips }) =>
          clips.length &&
          e.name.localName === "circle" &&
          attr(e, "fill") === "#CC8800",
      );
    expect(markers).toHaveLength(2);
  });
