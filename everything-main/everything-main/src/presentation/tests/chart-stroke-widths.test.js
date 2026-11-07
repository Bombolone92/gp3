import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  qname,
  walkElements,
  getAttrValue,
  elem,
  attr,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const value = (e, n) => getAttrValue(e, qname("", n, ""));
const keys = [
  "categoryAxisLineWidthEmu",
  "valueAxisLineWidthEmu",
  "categoryAxisMajorGridlineWidthEmu",
  "categoryAxisMinorGridlineWidthEmu",
  "valueAxisMajorGridlineWidthEmu",
  "valueAxisMinorGridlineWidthEmu",
  "secondaryCategoryAxisLineWidthEmu",
  "secondaryValueAxisLineWidthEmu",
  "plotAreaStrokeWidthEmu",
  "chartAreaStrokeWidthEmu",
];
const widths = (n) => Object.fromEntries(keys.map((key) => [key, n]));
const colors = {
  category: "#A84271",
  value: "#3166B8",
  grid: "#28A773",
  plot: "#D99622",
  chart: "#7543AA",
  secondary: "#C36929",
};
function fixture(spec = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const shape = P.addSlideChart(slide, {
    x: P.inches(1.3),
    y: P.inches(0.8),
    w: P.inches(7.2),
    h: P.inches(4.6),
    spec: {
      kind: "column",
      categories: ["North", "East", "South", "West"],
      series: [{ name: "Units", values: [4, -3, 7, 2] }],
      valueAxis: { min: -5, max: 10, majorUnit: 5 },
      categoryAxisLineColor: colors.category,
      valueAxisLineColor: colors.value,
      valueAxisMajorGridlines: true,
      valueAxisMajorGridlineColor: colors.grid,
      categoryAxisMajorGridlines: true,
      categoryAxisMinorGridlines: true,
      valueAxisMinorGridlines: true,
      plotAreaStrokeColor: colors.plot,
      chartAreaStrokeColor: colors.chart,
      categoryAxisLabelRotationDeg: 0,
      valueAxisLabelRotationDeg: 0,
      ...spec,
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
  return {
    svg,
    elements,
    strokes: (color) => elements.filter((e) => value(e, "stroke") === color),
  };
}
function expectWidth(nodes, px) {
  expect(nodes.length).toBeGreaterThan(0);
  for (const e of nodes)
    expect(Number(value(e, "stroke-width"))).toBeCloseTo(px, 10);
}
function edit(f, callback) {
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    plot = child(child(doc.root, "chart"), "plotArea");
  callback(doc.root, plot);
  f.part.data = new TextEncoder().encode(serializeXml(doc));
}
function nativeWidth(parent, raw) {
  let sp = child(parent, "spPr");
  if (!sp) {
    sp = elem(qname("c", "spPr", NS.chart));
    parent.children.push(sp);
  }
  let ln = child(sp, "ln", NS.dml);
  if (!ln) {
    ln = elem(qname("a", "ln", NS.dml));
    sp.children.push(ln);
  }
  ln.attrs = ln.attrs.filter((a) => a.name.localName !== "w");
  if (raw !== undefined) ln.attrs.push(attr(qname("", "w", ""), raw));
}
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);
describe("native chart decoration stroke widths", () => {
  for (const kind of ["scatter", "bubble"])
    for (const reverseXml of [false, true])
      it(`${kind} associates independent numeric-axis strokes by native position/references, reversed XML=${reverseXml}`, async () => {
        const f = fixture();
        edit(f, (_, plot) => {
          const x = child(plot, "catAx"),
            y = child(plot, "valAx"),
            xId = value(child(x, "axId"), "val"),
            yId = value(child(y, "axId"), "val"),
            cache = (values) =>
              `<c:numLit><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numLit>`;
          const group = parseXml(
            `<c:${kind}Chart xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${kind === "scatter" ? '<c:scatterStyle val="marker"/>' : ""}<c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="23AB4A"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="23AB4A"/></a:solidFill></a:ln></c:spPr>${kind === "scatter" ? '<c:marker><c:symbol val="circle"/></c:marker>' : ""}<c:xVal>${cache([1, 2, 3, 4])}</c:xVal><c:yVal>${cache([4, -3, 7, 2])}</c:yVal>${kind === "bubble" ? `<c:bubbleSize>${cache([1, 3, 2, 4])}</c:bubbleSize>` : ""}</c:ser><c:axId val="${xId}"/><c:axId val="${yId}"/></c:${kind}Chart>`,
          ).root;
          const numericX = parseXml(
            `<c:valAx xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><c:axId val="${xId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines><c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="CD862C"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="A84271"/></a:solidFill></a:ln></c:spPr><c:crossAx val="${yId}"/><c:crosses val="autoZero"/></c:valAx>`,
          ).root;
          nativeWidth(y, "47625");
          nativeWidth(child(y, "majorGridlines"), "9525");
          plot.children = plot.children
            .filter((e) => ![x, y, child(plot, "barChart")].includes(e))
            .concat(group, ...(reverseXml ? [y, numericX] : [numericX, y]));
        });
        const native = f.part.data.slice(),
          spec = P.getShapeChartSpec(f.shape),
          r = render(f);
        expect(spec.valueAxisLineWidthEmu).toBe(47625);
        expect(spec.categoryAxisLineWidthEmu).toBe(28575);
        expect(spec.valueAxisMajorGridlineWidthEmu).toBe(9525);
        expect(spec.categoryAxisMajorGridlineWidthEmu).toBe(19050);
        expect(spec.valueAxis).toMatchObject({
          min: -5,
          max: 10,
          majorUnit: 5,
        });
        for (const [color, width] of [
          [colors.category, 3],
          [colors.value, 5],
          [colors.grid, 1],
          ["#CD862C", 2],
        ])
          expectWidth(r.strokes(color), width);
        expect(
          r.elements.filter(
            (e) =>
              e.name.localName === "circle" && value(e, "fill") === "#23AB4A",
          ),
        ).toHaveLength(4);
        expect(f.part.data).toEqual(native);
        const q = createDeck("blank"),
          to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]);
        expect(preview(q, to)).toBe(preview(f.p, f.slide));
        const reopened = await P.loadPresentation(await P.savePresentation(q));
        expect(P.getSlideCharts(P.getSlides(reopened).at(-1))[0].spec).toEqual(
          spec,
        );
        expect(P.validatePresentation(reopened)).toEqual([]);
      });
  for (const kind of ["column", "bar", "line", "area"])
    it.each([0, 1, 9525, 38100])(
      `${kind} uses %s EMU for axis spines, tick marks, gridlines and borders`,
      (width) => {
        const f = fixture({ kind, ...widths(width) }),
          before = f.part.data.slice(),
          r = render(f);
        for (const color of [
          colors.category,
          colors.value,
          colors.grid,
          colors.plot,
          colors.chart,
        ])
          expectWidth(r.strokes(color), width / 9525);
        for (const key of keys.slice(0, 6).concat(keys.slice(8)))
          expect(P.getShapeChartSpec(f.shape)[key]).toBe(width);
        expect(r.svg).not.toMatch(/NaN|Infinity/);
        expect(f.part.data).toEqual(before);
        expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
          4, -3, 7, 2,
        ]);
      },
    );
  it("reads explicit native widths independently of paint and retains omitted defaults", () => {
    const f = fixture();
    edit(f, (root, plot) => {
      nativeWidth(child(plot, "catAx"), "28575");
      nativeWidth(child(plot, "valAx"), "47625");
      nativeWidth(child(child(plot, "valAx"), "majorGridlines"), "9525");
      nativeWidth(plot, "19050");
      nativeWidth(root, "76200");
    });
    const before = f.part.data.slice(),
      r = render(f),
      s = P.getShapeChartSpec(f.shape);
    expect(s.categoryAxisLineWidthEmu).toBe(28575);
    expect(s.valueAxisMajorGridlineWidthEmu).toBe(9525);
    for (const [color, width] of [
      [colors.category, 3],
      [colors.value, 5],
      [colors.grid, 1],
      [colors.plot, 2],
      [colors.chart, 8],
    ])
      expectWidth(r.strokes(color), width);
    expect(f.part.data).toEqual(before);
    const omitted = render(fixture());
    expectWidth(omitted.strokes(colors.category), 1);
    expectWidth(omitted.strokes(colors.value), 1);
    expectWidth(omitted.strokes(colors.grid), 1);
    expectWidth(omitted.strokes(colors.plot), 1);
    expectWidth(omitted.strokes(colors.chart), 1);
  });
  it.each([
    "-1",
    "20116801",
    "Infinity",
    "NaN",
    "9525x",
    "9525.0",
    "1e4",
    "",
    "0x10",
  ])(
    "ignores malformed native w=%j without changing the source or other styles",
    (raw) => {
      const f = fixture();
      edit(f, (_, plot) =>
        nativeWidth(child(child(plot, "valAx"), "majorGridlines"), raw),
      );
      const before = f.part.data.slice(),
        s = P.getShapeChartSpec(f.shape),
        r = render(f);
      expect(s.valueAxisMajorGridlineWidthEmu).toBeUndefined();
      expect(s.valueAxisMajorGridlineColor).toBe(colors.grid);
      expectWidth(r.strokes(colors.grid), 1);
      expect(f.part.data).toEqual(before);
    },
  );
  it.each(["  +9525\t", "0009525"])(
    "reads the valid XML integer form w=%j",
    (raw) => {
      const f = fixture();
      edit(f, (_, plot) =>
        nativeWidth(child(child(plot, "valAx"), "majorGridlines"), raw),
      );
      expect(P.getShapeChartSpec(f.shape).valueAxisMajorGridlineWidthEmu).toBe(
        9525,
      );
      expectWidth(render(f).strokes(colors.grid), 1);
    },
  );
  it("keeps noFill independent of authored widths and retains labels/data", () => {
    const f = fixture({
        ...widths(38100),
        categoryAxisLineColor: null,
        valueAxisLineColor: null,
        valueAxisMajorGridlineColor: null,
        valueAxisMinorGridlineColor: null,
        categoryAxisMajorGridlineColor: null,
        categoryAxisMinorGridlineColor: null,
        chartAreaStrokeColor: null,
        plotAreaStrokeColor: null,
      }),
      r = render(f);
    for (const key of keys.slice(0, 6).concat(keys.slice(8)))
      expect(P.getShapeChartSpec(f.shape)[key]).toBe(38100);
    const lines = r.elements.filter((e) => e.name.localName === "line");
    expect(lines.length).toBeGreaterThan(0);
    for (const e of lines) expect(value(e, "stroke")).toBe("none");
    expect(r.svg).toContain("North");
    expect(r.svg).not.toContain("no data");
  });
  it("uses referenced secondary-axis widths independently after native axis reordering", () => {
    const f = fixture({
      valueAxisLineWidthEmu: 47625,
      secondaryValueAxisLineWidthEmu: 19050,
      secondaryValueAxisLineColor: colors.secondary,
      secondaryCategoryAxisLineWidthEmu: 28575,
      secondaryCategoryAxisLineColor: "#BD3594",
      series: [
        { values: [4, -3, 7, 2] },
        { chartKind: "line", secondaryAxis: true, values: [40, -30, 70, 20] },
      ],
    });
    const spec = P.getShapeChartSpec(f.shape),
      before = render(f).svg;
    expect(spec.secondaryValueAxisLineWidthEmu).toBe(19050);
    expect(spec.secondaryCategoryAxisLineWidthEmu).toBe(28575);
    expectWidth(render(f).strokes(colors.secondary), 2);
    edit(f, (_, plot) => {
      const axes = allChildElements(plot, qname("", "valAx", NS.chart)).concat(
        allChildElements(plot, qname("", "catAx", NS.chart)),
      );
      plot.children = plot.children
        .filter((e) => !axes.includes(e))
        .concat(axes.toReversed());
    });
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    expect(render(f).svg).toBe(before);
  });
  for (const key of keys)
    it.each([0, 20116800])(
      `round-trips the ST_LineWidth boundary %s for ${key}`,
      (width) => {
        const f = fixture({
          [key]: width,
          series: [
            { values: [4, -3, 7, 2] },
            {
              chartKind: "line",
              secondaryAxis: true,
              values: [40, -30, 70, 20],
            },
          ],
        });
        expect(P.getShapeChartSpec(f.shape)[key]).toBe(width);
        expect(P.validatePresentation(f.p)).toEqual([]);
      },
    );
  for (const key of keys)
    it.each([-1, 20116801, NaN, Infinity, null, "9525"])(
      `rejects invalid authored ${key}=%j before any package mutation`,
      (bad) => {
        const f = fixture(),
          before = snapshot(f.p);
        expect(() =>
          P.setChartSpec(P.getSlideCharts(f.slide)[0], {
            ...P.getShapeChartSpec(f.shape),
            [key]: bad,
          }),
        ).toThrow(key);
        expect(snapshot(f.p)).toEqual(before);
      },
    );
  it("preserves all native widths through export, editable transfer both ways and data edits", async () => {
    const fields = Object.fromEntries(
        keys.map((key, i) => [key, (i + 1) * 9525]),
      ),
      f = fixture({
        ...fields,
        secondaryValueAxisLineColor: colors.secondary,
        series: [
          { values: [4, -3, 7, 2] },
          { chartKind: "line", secondaryAxis: true, values: [40, -30, 70, 20] },
        ],
      });
    const original = P.getShapeChartSpec(f.shape),
      before = f.part.data.slice();
    for (const key of keys) expect(original[key]).toBe(fields[key]);
    const q = createDeck("blank"),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
    for (const slide of [to, back]) {
      const chart = P.getSlideCharts(slide)[0];
      expect(chart.spec).toEqual(original);
      expect(workbook(slide === to ? q : f.p, chart.shape).data).toEqual(
        workbook(f.p, f.shape).data,
      );
    }
    expect(preview(q, to)).toBe(preview(f.p, f.slide));
    const copied = P.getSlideCharts(back)[0];
    P.setChartSpec(copied, {
      ...copied.spec,
      valueAxisMajorGridlineWidthEmu: 28575,
      series: copied.spec.series.map((series) => ({
        ...series,
        values: series.values.map((n) => n + 1),
      })),
    });
    expect(f.part.data).toEqual(before);
    const saved = await P.loadPresentation(await P.savePresentation(f.p)),
      edited = P.getSlideCharts(P.getSlides(saved).at(-1))[0];
    expect(edited.spec.valueAxisMajorGridlineWidthEmu).toBe(28575);
    for (const key of keys.filter(
      (k) => k !== "valueAxisMajorGridlineWidthEmu",
    ))
      expect(edited.spec[key]).toBe(fields[key]);
    expect(P.validatePresentation(saved)).toEqual([]);
  });
});
