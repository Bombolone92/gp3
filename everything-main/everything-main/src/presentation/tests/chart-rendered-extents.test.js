import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const labelColor = "#3C1A7E",
  dataColor = "#167B83";
function fixture(spec = {}) {
  const { kind = "column", ...options } = spec;
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const shape = P.addSlideChart(slide, {
    x: P.inches(0.75),
    y: P.inches(0.5),
    w: P.inches(7),
    h: P.inches(4.5),
    spec: {
      kind: kind === "radar" ? "line" : kind,
      categories: ["Named"],
      series: [{ name: "Units", values: [2, 7, 3, 9], color: dataColor }],
      legend: { position: null },
      categoryAxisLabelStyle: { color: labelColor },
      categoryAxisLabelRotationDeg: 0,
      ...options,
      lineMarkers: false,
    },
  });
  const part = P._internalPackageOf(p).getPart(chartRoot(shape));
  if (kind === "radar") {
    // Radar is read-only in the public API. Use a native, schema-shaped
    // radar plot with the same owned independent caches and text styles.
    const doc = parseXml(new TextDecoder().decode(part.data));
    const child = (e, n) => firstChildElement(e, qname("", n, NS.chart));
    const plot = child(child(doc.root, "chart"), "plotArea"),
      group = child(plot, "lineChart");
    group.name = qname("c", "radarChart", NS.chart);
    child(group, "grouping").name = qname("c", "radarStyle", NS.chart);
    group.children = group.children.filter(
      (e) => e.kind !== "element" || e.name.localName !== "marker",
    );
    part.data = new TextEncoder().encode(serializeXml(doc));
  }
  return { p, slide, shape, part };
}
function rendered(f) {
  const svg = renderSlideToSvg(f.p, f.slide),
    labels = [],
    elements = [];
  walkElements(parseXml(svg).root, (e) => {
    elements.push(e);
    if (e.name.localName === "text" && attr(e, "fill") === labelColor)
      labels.push(
        e.children
          .filter((c) => c.kind === "text")
          .map((c) => c.data)
          .join(""),
      );
  });
  return { svg, labels, elements };
}
function plotted(r, kind, color = dataColor) {
  if (kind === "bar" || kind === "column")
    return r.elements.filter(
      (e) =>
        e.name.localName === "rect" &&
        attr(e, "fill") === color &&
        Number(attr(e, "width")) > 0 &&
        Number(attr(e, "height")) > 0,
    ).length;
  if (kind === "radar") {
    const poly = r.elements.find(
      (e) => e.name.localName === "polygon" && attr(e, "stroke") === color,
    );
    return poly ? attr(poly, "points").trim().split(/\s+/).length : 0;
  }
  const path = r.elements.find(
    (e) => e.name.localName === "path" && attr(e, "stroke") === color,
  );
  return path ? (attr(path, "d").match(/[ML]/g) ?? []).length : 0;
}
describe("category chart rendered data extents", () => {
  for (const kind of ["bar", "column", "line", "area", "radar"]) {
    it(`${kind} plots every value when only the first category is labeled`, () => {
      const f = fixture({ kind }),
        before = f.part.data.slice(),
        r = rendered(f);
      expect(r.labels).toEqual(
        kind === "radar" ? ["Named", "2", "3", "4"] : ["Named"],
      );
      expect(plotted(r, kind)).toBe(4);
      expect(P.getShapeChartSpec(f.shape).categories).toEqual(["Named"]);
      expect(f.part.data).toEqual(before);
    });
    it(`${kind} retains a trailing blank domain beyond partial labels`, () => {
      const f = fixture({
          kind,
          series: [
            { name: "Units", color: dataColor, values: [2, 7, null, null] },
          ],
        }),
        r = rendered(f);
      expect(r.labels).toEqual(
        kind === "radar" ? ["Named", "2", "3", "4"] : ["Named"],
      );
      expect(plotted(r, kind)).toBe(2);
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        2,
        7,
        null,
        null,
      ]);
    });
    it(`${kind} uses the longest independent series when category labels are shorter`, () => {
      const second = "#9F3072",
        f = fixture({
          kind,
          categories: ["First", "Second"],
          series: [
            { name: "Short", color: dataColor, values: [3, 1] },
            { name: "Long", color: second, values: [2, 7, 3, 9, 4] },
          ],
        }),
        r = rendered(f);
      expect(r.labels).toEqual(
        kind === "radar"
          ? ["First", "Second", "3", "4", "5"]
          : ["First", "Second"],
      );
      expect(plotted(r, kind)).toBe(2);
      expect(plotted(r, kind, second)).toBe(5);
    });
    it(`${kind} keeps the existing unlabeled and fully labeled domains`, () => {
      for (const [categories, expected] of [
        // Creation omits an empty category source; it is distinct from a
        // native present-but-empty cache, which keeps its labels blank.
        [[], ["1", "2", "3", "4"]],
        [
          ["A", "B", "C", "D"],
          ["A", "B", "C", "D"],
        ],
        [
          ["A", "B", "C", "D", "E"],
          kind === "radar" ? ["A", "B", "C", "D", "E"] : ["A", "B", "C", "D"],
        ],
      ]) {
        const r = rendered(fixture({ kind, categories }));
        expect(r.labels).toEqual(expected);
        expect(plotted(r, kind)).toBe(4);
      }
    });
  }
  it.each([false, true])(
    "resolves domains across shared or independent plot groups (secondary: %s)",
    (secondary) => {
      const second = "#9F3072",
        r = rendered(
          fixture({
            series: [
              { name: "Columns", color: dataColor, values: [3, 1] },
              {
                name: "Line",
                color: second,
                chartKind: "line",
                secondaryAxis: secondary,
                values: [2, 7, 3, 9, 4],
              },
            ],
          }),
        );
      expect(r.labels).toEqual(["Named"]);
      expect(plotted(r, "column")).toBe(2);
      expect(plotted(r, "line", second)).toBe(5);
      const bars = r.elements.filter(
        (e) =>
          e.name.localName === "rect" &&
          attr(e, "fill") === dataColor &&
          Number(attr(e, "height")) > 0,
      );
      const line = r.elements.find(
        (e) => e.name.localName === "path" && attr(e, "stroke") === second,
      );
      const xs = [...attr(line, "d").matchAll(/[ML]([-\d.]+),[-\d.]+/g)].map(
        (m) => Number(m[1]),
      );
      const span = ((xs.at(-1) - xs[0]) * 5) / 4,
        origin = xs[0] - span / 10;
      bars.forEach((b, i) =>
        expect(Number(attr(b, "x")) + Number(attr(b, "width")) / 2).toBeCloseTo(
          secondary ? origin + ((i + 0.5) * span) / 2 : xs[i],
          1,
        ),
      );
    },
  );
  it("retains skipped labels without truncating corresponding data", () => {
    const r = rendered(fixture({ kind: "line", categoryAxisTickLabelSkip: 2 }));
    expect(r.labels).toEqual(["Named"]);
    expect(plotted(r, "line")).toBe(4);
  });
  it("retains all declared blank positions and a genuinely empty domain", () => {
    const blank = rendered(
      fixture({
        series: [{ name: "Blank", values: [null, null, null, null] }],
      }),
    );
    expect(blank.labels).toEqual(["Named"]);
    const empty = rendered(
      fixture({ categories: [], series: [{ name: "Empty", values: [] }] }),
    );
    // The builder omits an empty category source. Native empty axes retain
    // their default 0..1 domain and generate the category at index 1.
    expect(empty.labels).toEqual(["1"]);
  });
  it("retains full rendered data through native transfer both ways, export and independent edits", async () => {
    const f = fixture({ kind: "line" }),
      before = f.part.data.slice(),
      sourceWorkbook = workbook(f.p, f.shape).data.slice(),
      q = createDeck("blank");
    const to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
    expect(preview(q, to)).toBe(preview(f.p, f.slide));
    const copied = P.getSlideCharts(back)[0];
    P.setChartSpec(copied, {
      ...copied.spec,
      series: [{ ...copied.spec.series[0], values: [3, 8, 2, 6, 4] }],
    });
    const p = await P.loadPresentation(await P.savePresentation(f.p));
    const slide = P.getSlides(p).at(-1),
      shape = P.getSlideCharts(slide)[0].shape;
    const r = rendered({ p, slide, shape });
    expect(r.labels).toEqual(["Named"]);
    expect(plotted(r, "line")).toBe(5);
    expect(f.part.data).toEqual(before);
    expect(workbook(f.p, f.shape).data).toEqual(sourceWorkbook);
    expect(P.validatePresentation(p)).toEqual([]);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
