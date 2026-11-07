import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRoot, chartGraph, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  qname,
  walkElements,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";

const axisColor = "#853CB5",
  dataColor = "#267AB4";
const categories = ["North", "East", "South", "West"];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const child = (e, n) => firstChildElement(e, qname("", n, NS.chart));
const text = (e) =>
  e.children
    .filter((c) => c.kind === "text")
    .map((c) => c.data)
    .join("");
function fixture(kind, mode, overrides = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const shape = P.addSlideChart(slide, {
    x: P.inches(0.8),
    y: P.inches(0.6),
    w: P.inches(8),
    h: P.inches(4.5),
    spec: {
      kind,
      categories,
      series: [
        {
          name: "Units",
          values: [2, 7, 3, 5],
          color: dataColor,
          markerSymbol: "circle",
        },
      ],
      valueAxisCrossBetween: mode,
      categoryAxisLineColor: axisColor,
      categoryAxisLabelRotationDeg: 0,
      categoryAxisMajorTickMark: "cross",
      categoryAxisMinorTickMark: "none",
      valueAxisHidden: true,
      ...overrides,
    },
  });
  return {
    p,
    slide,
    shape,
    part: P._internalPackageOf(p).getPart(chartRoot(shape)),
  };
}
function render(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    elements = [];
  walkElements(parseXml(svg).root, (e) => elements.push(e));
  const bar = P.getShapeChartSpec(f.shape).kind === "bar",
    coordinate = bar ? "y" : "x";
  const lines = elements.filter(
    (e) => e.name.localName === "line" && attr(e, "stroke") === axisColor,
  );
  const spine = lines.find((e) =>
    bar ? attr(e, "x1") === attr(e, "x2") : attr(e, "y1") === attr(e, "y2"),
  );
  const low = Math.min(
    Number(attr(spine, coordinate + "1")),
    Number(attr(spine, coordinate + "2")),
  );
  const high = Math.max(
    Number(attr(spine, coordinate + "1")),
    Number(attr(spine, coordinate + "2")),
  );
  const ticks = lines
    .filter((e) => e !== spine)
    .map((e) => Number(attr(e, coordinate + "1")));
  const labels = elements.filter(
    (e) => e.name.localName === "text" && categories.includes(text(e)),
  );
  const points = elements
    .filter(
      (e) => e.name.localName === "circle" && attr(e, "fill") === dataColor,
    )
    .map((e) => Number(attr(e, "cx")));
  const bars = elements
    .filter((e) => e.name.localName === "rect" && attr(e, "fill") === dataColor)
    .map(
      (e) =>
        Number(attr(e, coordinate)) +
        Number(attr(e, bar ? "height" : "width")) / 2,
    );
  const area = elements.find(
    (e) =>
      e.name.localName === "path" &&
      (attr(e, "fill") === dataColor || attr(e, "stroke") === dataColor),
  );
  const areaPoints = area
    ? Array.from(
        attr(area, "d").matchAll(/[ML]\s*([-\d.]+)[ ,]+([-\d.]+)/g),
        (m) => Number(m[1]),
      ).slice(0, P.getShapeChartSpec(f.shape).series[0].values.length)
    : [];
  return {
    svg,
    elements,
    low,
    high,
    ticks,
    labels,
    coordinate,
    data:
      bar || P.getShapeChartSpec(f.shape).kind === "column"
        ? bars
        : points.length
          ? points
          : areaPoints,
  };
}
function expectedCenters(r, mode, n, reversed, bar) {
  const length = r.high - r.low;
  return Array.from({ length: n }, (_, i) => {
    const fraction =
      mode === "midCat" ? (n === 1 ? 0 : i / (n - 1)) : (i + 0.5) / n;
    return r.low + (reversed !== bar ? 1 - fraction : fraction) * length;
  });
}
describe("native category-axis spacing", () => {
  for (const angle of [-45, 45])
    it.each([undefined, "l", "r", "ctr"])(
      `reserves midCat endpoint margins for ${angle}-degree labels with alignment %j`,
      (align) => {
        const names = ["First descriptive region", "Last descriptive region"],
          f = fixture("line", "midCat", {
            categories: names,
            categoryAxisLabelRotationDeg: angle,
            categoryAxisLabelAlign: align,
            series: [{ values: [2, 7] }],
          });
        const measure = (text, font) => ({
            widthPx: text.length * font.sizePx * 0.6,
            ascentPx: font.sizePx * 0.8,
            descentPx: font.sizePx * 0.2,
          }),
          elements = [];
        walkElements(
          parseXml(renderSlideToSvg(f.p, f.slide, { measureText: measure }))
            .root,
          (e) => elements.push(e),
        );
        const box = elements.find((e) => e.name.localName === "rect"),
          left = Number(attr(box, "x")),
          right = left + Number(attr(box, "width")),
          bottom = Number(attr(box, "y")) + Number(attr(box, "height")),
          spine = elements.find(
            (e) =>
              e.name.localName === "line" &&
              attr(e, "stroke") === axisColor &&
              attr(e, "y1") === attr(e, "y2"),
          );
        const labels = elements.filter(
          (e) => e.name.localName === "text" && names.includes(text(e)),
        );
        expect(labels).toHaveLength(2);
        for (const e of labels) {
          const sizePx = Number(attr(e, "font-size")),
            width = measure(text(e), { sizePx }).widthPx,
            anchor = attr(e, "text-anchor"),
            x = Number(attr(e, "x"));
          const start =
              anchor === "start" ? 0 : anchor === "end" ? -width : -width / 2,
            rad = (angle * Math.PI) / 180;
          const a = start * Math.cos(rad),
            b = (start + width) * Math.cos(rad),
            halfHeight = (sizePx / 2) * Math.abs(Math.sin(rad));
          expect(x + Math.min(a, b) - halfHeight).toBeGreaterThanOrEqual(
            left - 0.02,
          );
          expect(x + Math.max(a, b) + halfHeight).toBeLessThanOrEqual(
            right + 0.02,
          );
          const ya = start * Math.sin(rad),
            yb = (start + width) * Math.sin(rad),
            yHalf = (sizePx / 2) * Math.abs(Math.cos(rad)),
            y = Number(attr(e, "y"));
          expect(y + Math.min(ya, yb) - yHalf).toBeGreaterThanOrEqual(
            Number(attr(spine, "y1")) - 0.02,
          );
          expect(y + Math.max(ya, yb) + yHalf).toBeLessThanOrEqual(
            bottom + 0.02,
          );
          expect(attr(e, "transform")).toContain(`rotate(${angle} `);
        }
      },
    );
  for (const kind of ["column", "bar", "line", "area"])
    it.each(["stacked", "percentStacked"])(
      `${kind} keeps stacked geometry on authored midCat positions (%s)`,
      (grouping) => {
        const f = fixture(kind, "midCat", { grouping }),
          r = render(f);
        const expected = expectedCenters(r, "midCat", 4, false, kind === "bar");
        expect(r.data).toHaveLength(4);
        for (const [i, p] of r.data.entries())
          expect(p).toBeCloseTo(expected[i], 1);
      },
    );
  for (const kind of ["column", "bar", "line", "area"])
    for (const mode of ["between", "midCat"])
      for (const reversed of [false, true])
        it(`${kind} ${mode} ${reversed ? "reversed" : "forward"} aligns data, labels and tick lattice`, () => {
          const f = fixture(kind, mode, {
              categoryAxisOrientation: reversed ? "maxMin" : "minMax",
            }),
            before = f.part.data.slice(),
            r = render(f);
          const expected = expectedCenters(
            r,
            mode,
            4,
            reversed,
            kind === "bar",
          );
          expect(r.labels.map(text)).toEqual(categories);
          for (const [i, label] of r.labels.entries())
            expect(Number(attr(label, r.coordinate))).toBeCloseTo(
              expected[i],
              1,
            );
          expect(r.data).toHaveLength(4);
          for (const [i, position] of r.data.entries())
            expect(position).toBeCloseTo(expected[i], 1);
          expect(r.ticks).toHaveLength(mode === "between" ? 5 : 4);
          const ticks = r.ticks.toSorted((a, b) => a - b);
          if (mode === "midCat")
            for (const [i, p] of expected.toSorted((a, b) => a - b).entries())
              expect(ticks[i]).toBeCloseTo(p, 1);
          expect(ticks[0]).toBeCloseTo(r.low, 1);
          expect(ticks.at(-1)).toBeCloseTo(r.high, 1);
          expect(f.part.data).toEqual(before);
        });
  it.each(["column", "bar", "line", "area"])(
    "%s uses the compatible omitted mode",
    (kind) => {
      const f = fixture(kind),
        explicit = fixture(kind, kind === "area" ? "midCat" : "between");
      expect(render(f).svg).toBe(render(explicit).svg);
      expect(
        P.getShapeChartSpec(f.shape).valueAxisCrossBetween,
      ).toBeUndefined();
    },
  );
  for (const kind of ["column", "bar", "line", "area"])
    it.each(["between", "midCat"])(
      `${kind} keeps a single category on its %s domain`,
      (mode) => {
        const f = fixture(kind, mode, {
            categories: ["North"],
            series: [{ values: [7], color: dataColor, markerSymbol: "circle" }],
          }),
          r = render(f);
        const expected = expectedCenters(r, mode, 1, false, kind === "bar")[0];
        expect(Number(attr(r.labels[0], r.coordinate))).toBeCloseTo(
          expected,
          1,
        );
        for (const p of r.data) expect(p).toBeCloseTo(expected, 1);
        expect(r.ticks).toHaveLength(mode === "between" ? 2 : 1);
        expect(r.svg).not.toMatch(/NaN|Infinity/);
      },
    );
  it.each(["column", "bar", "line", "area"])(
    "%s applies independent label/tick strides to the complete midCat domain",
    (kind) => {
      const f = fixture(kind, "midCat", {
          categories: ["North", "East"],
          categoryAxisTickLabelSkip: 2,
          categoryAxisTickMarkSkip: 3,
        }),
        r = render(f);
      expect(r.labels.map(text)).toEqual(["North"]);
      expect(r.data).toHaveLength(4);
      expect(r.ticks.toSorted((a, b) => a - b)).toEqual([r.low, r.high]);
      expect(
        r.elements.some((e) => e.name.localName === "text" && text(e) === "3"),
      ).toBe(false);
    },
  );
  it("shares one primary coordinate rule across columns and area/line overlays, with an independent secondary pair", () => {
    const f = fixture("column", "between", {
        secondaryValueAxisCrossBetween: "midCat",
        series: [
          { values: [2, 7, 3, 5], color: dataColor },
          { values: [2, 7, 3, 5], chartKind: "area", color: "#27A565" },
          {
            values: [2, 7, 3, 5],
            chartKind: "line",
            color: "#C97C26",
            markerSymbol: "circle",
          },
          {
            values: [20, 70, 30, 50],
            chartKind: "line",
            secondaryAxis: true,
            color: "#BD3893",
            markerSymbol: "circle",
          },
        ],
      }),
      r = render(f);
    const points = (color) => {
      const path = r.elements.find(
        (e) =>
          e.name.localName === "path" &&
          attr(e, "stroke") === color &&
          attr(e, "fill") === "none",
      );
      expect(path).toBeDefined();
      return Array.from(
        attr(path, "d").matchAll(/[ML]\s*([-\d.]+)[ ,]+([-\d.]+)/g),
        (m) => Number(m[1]),
      );
    };
    const primary = expectedCenters(r, "between", 4, false, false),
      secondary = expectedCenters(r, "midCat", 4, false, false);
    for (const [i, p] of points("#C97C26").entries())
      expect(p).toBeCloseTo(primary[i], 1);
    expect(points("#BD3893")).toHaveLength(4);
    for (const [i, p] of points("#BD3893").entries())
      expect(p).toBeCloseTo(secondary[i], 1);
    const area = r.elements.find(
      (e) => e.name.localName === "path" && attr(e, "fill") === "#27A565",
    );
    const areaXs = Array.from(
      attr(area, "d").matchAll(/[ML]\s*([-\d.]+)[ ,]+([-\d.]+)/g),
      (m) => Number(m[1]),
    ).slice(0, 4);
    for (const [i, p] of areaXs.entries()) expect(p).toBeCloseTo(primary[i], 1);
    expect(P.getShapeChartSpec(f.shape).secondaryValueAxisCrossBetween).toBe(
      "midCat",
    );
  });
  it("reads referenced primary and secondary settings even when native axes are reordered", () => {
    const f = fixture("column", "midCat", {
      secondaryValueAxisCrossBetween: "between",
      series: [
        { values: [2, 7, 3, 5] },
        { values: [20, 70, 30, 50], secondaryAxis: true, chartKind: "line" },
      ],
    });
    const doc = parseXml(new TextDecoder().decode(f.part.data)),
      plot = child(child(doc.root, "chart"), "plotArea"),
      axes = allChildElements(plot, qname("", "valAx", NS.chart));
    const before = render(f).svg;
    plot.children = plot.children
      .filter((e) => !axes.includes(e))
      .concat(axes.toReversed());
    f.part.data = new TextEncoder().encode(serializeXml(doc));
    const s = P.getShapeChartSpec(f.shape);
    expect(s.valueAxisCrossBetween).toBe("midCat");
    expect(s.secondaryValueAxisCrossBetween).toBe("between");
    expect(render(f).svg).toBe(before);
  });
  it.each([undefined, "", "invalid"])(
    "uses independent defaults for malformed/omitted native secondary spacing %j without changing XML",
    (value) => {
      const f = fixture("column", "midCat", {
        secondaryValueAxisCrossBetween: "between",
        series: [
          { values: [2, 7, 3, 5] },
          {
            values: [20, 70, 30, 50],
            secondaryAxis: true,
            chartKind: "line",
            color: "#D53780",
          },
        ],
      });
      const doc = parseXml(new TextDecoder().decode(f.part.data)),
        plot = child(child(doc.root, "chart"), "plotArea"),
        axis = allChildElements(plot, qname("", "valAx", NS.chart))[1];
      child(axis, "crossBetween").attrs =
        value === undefined ? [] : [{ name: qname("", "val", ""), value }];
      f.part.data = new TextEncoder().encode(serializeXml(doc));
      const native = f.part.data.slice(),
        r = render(f),
        spec = P.getShapeChartSpec(f.shape);
      expect(spec.valueAxisCrossBetween).toBe("midCat");
      expect(spec.secondaryValueAxisCrossBetween).toBeUndefined();
      const path = r.elements.find(
          (e) => e.name.localName === "path" && attr(e, "stroke") === "#D53780",
        ),
        xs = Array.from(
          attr(path, "d").matchAll(/[ML]\s*([-\d.]+)[ ,]+([-\d.]+)/g),
          (m) => Number(m[1]),
        );
      const expected = expectedCenters(r, "between", 4, false, false);
      expect(xs).toHaveLength(4);
      for (const [i, p] of xs.entries()) expect(p).toBeCloseTo(expected[i], 1);
      expect(f.part.data).toEqual(native);
    },
  );
  it("retains native settings, workbooks and editable data through export and transfer both ways", async () => {
    const f = fixture("column", "midCat", {
      secondaryValueAxisCrossBetween: "between",
      series: [
        { values: [2, 7, 3, 5] },
        { values: [20, 70, 30, 50], secondaryAxis: true, chartKind: "line" },
      ],
    });
    const native = f.part.data.slice(),
      original = P.getShapeChartSpec(f.shape),
      source = render(f).svg;
    const reopened = await P.loadPresentation(await P.savePresentation(f.p));
    const s = P.getSlides(reopened)[0],
      shape = P.getSlideCharts(s)[0].shape;
    expect(
      P._internalPackageOf(reopened).getPart(chartRoot(shape)).data,
    ).toEqual(native);
    expect(preview(reopened, s)).toBe(preview(f.p, f.slide));
    const target = createDeck("blank"),
      slide = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0]);
    const copy = P.getSlideCharts(slide)[0].shape;
    expect(P.getShapeChartSpec(copy)).toEqual(original);
    expect(workbook(target, copy).data).toEqual(workbook(f.p, f.shape).data);
    expect(chartGraph(target, chartRoot(copy)).length).toBe(
      chartGraph(f.p, chartRoot(f.shape)).length,
    );
    const returnedSlide = P.importSlide(f.p, slide, P.getSlideLayout(f.slide)),
      returned = P.getSlideCharts(returnedSlide)[0].shape;
    expect(P.getShapeChartSpec(returned)).toEqual(original);
    P.setChartSpec(P.getSlideCharts(returnedSlide)[0], {
      ...original,
      secondaryValueAxisCrossBetween: "midCat",
    });
    expect(P.getShapeChartSpec(f.shape)).toEqual(original);
    expect(P.validatePresentation(target)).toEqual([]);
    expect(P.validatePresentation(f.p)).toEqual([]);
    expect(source).not.toMatch(/NaN|Infinity/);
  });
  for (const key of ["valueAxisCrossBetween", "secondaryValueAxisCrossBetween"])
    it.each([null, "at", "", 1, {}, "BETWEEN"])(
      `rejects malformed authored ${key}=%j before changing the chart`,
      (bad) => {
        const f = fixture("line", "midCat"),
          before = f.part.data.slice();
        expect(() =>
          P.setChartSpec(P.getSlideCharts(f.slide)[0], {
            ...P.getShapeChartSpec(f.shape),
            [key]: bad,
          }),
        ).toThrow(/ST_CrossBetween/);
        expect(f.part.data).toEqual(before);
      },
    );
});
