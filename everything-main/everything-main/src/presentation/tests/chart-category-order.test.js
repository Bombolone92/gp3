import { paintPlotGuides } from "./chart-plot-guides-fixture.js";
import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  qname,
  NS,
  walkElements,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, "")),
  child = (e, n) => firstChildElement(e, qname("", n, NS.chart));
const colors = ["#1869A4", "#E58729"],
  axisColor = "#9436AF",
  categories = ["North", "East", "South", "West", "Central"];
function fixture(kind = "column", overrides = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.inches(1.2),
      y: P.inches(0.7),
      w: P.inches(8),
      h: P.inches(4.6),
      spec: {
        kind,
        categories,
        series: [
          {
            name: "Units",
            color: colors[0],
            values: [2, 7, 3, 5, 1],
            dataLabels: { showValue: true },
          },
        ],
        categoryAxisOrientation: "minMax",
        categoryAxisLabelRotationDeg: 0,
        valueAxisLabelRotationDeg: 0,
        categoryAxisLineColor: axisColor,
        categoryAxisMajorTickMark: "cross",
        categoryAxisTickMarkSkip: 2,
        categoryAxisTickLabelSkip: 2,
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
function editXml(f, mutate) {
  const doc = parseXml(new TextDecoder().decode(f.part.data));
  mutate(child(child(doc.root, "chart"), "plotArea"));
  f.part.data = new TextEncoder().encode(serializeXml(doc));
}
function render(f) {
  paintPlotGuides(f);
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    elements = [];
  walkElements(parseXml(svg).root, (e) => elements.push(e));
  const bar = P.getShapeChartSpec(f.shape).kind === "bar",
    lines = elements.filter(
      (e) => e.name.localName === "line" && attr(e, "stroke") === axisColor,
    ),
    spine = lines.find((e) =>
      bar ? attr(e, "x1") === attr(e, "x2") : attr(e, "y1") === attr(e, "y2"),
    ),
    axis = bar ? "y" : "x",
    sum = spine
      ? Number(attr(spine, axis + "1")) + Number(attr(spine, axis + "2"))
      : null;
  return { svg, elements, bar, sum };
}
const text = (e) =>
  e.children
    .filter((c) => c.kind === "text")
    .map((c) => c.data)
    .join("");
const paths = (r) =>
  r.elements.filter(
    (e) =>
      e.name.localName === "path" &&
      (colors.includes(attr(e, "fill")) || colors.includes(attr(e, "stroke"))),
  );
const points = (e) =>
  [...attr(e, "d").matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
function reflect(a, b) {
  expect(b.sum).toBe(a.sum);
  const aa = a.elements.filter(
      (e) => e.name.localName === "rect" && colors.includes(attr(e, "fill")),
    ),
    bb = b.elements.filter(
      (e) => e.name.localName === "rect" && colors.includes(attr(e, "fill")),
    );
  expect(bb).toHaveLength(aa.length);
  const coordinate = a.bar ? "y" : "x",
    extent = a.bar ? "height" : "width",
    other = a.bar ? "x" : "y";
  for (let i = 0; i < aa.length; i++) {
    expect(
      Number(attr(bb[i], coordinate)) + Number(attr(bb[i], extent)),
    ).toBeCloseTo(a.sum - Number(attr(aa[i], coordinate)), 1);
    for (const k of [extent, other, a.bar ? "width" : "height", "fill"])
      expect(attr(bb[i], k)).toBe(attr(aa[i], k));
  }
  const pp = paths(a),
    qq = paths(b);
  expect(qq).toHaveLength(pp.length);
  for (let i = 0; i < pp.length; i++) {
    const original = points(pp[i]),
      actual = points(qq[i]);
    expect(actual).toHaveLength(original.length);
    for (let j = 0; j < actual.length; j++)
      expect(actual[j]).toBeCloseTo(
        j % 2 === 0 ? a.sum - original[j] : original[j],
        1,
      );
  }
  const labels = (r) =>
    r.elements.filter(
      (e) =>
        e.name.localName === "text" &&
        (categories.includes(text(e)) ||
          ["1", "2", "3", "5", "7"].includes(text(e))),
    );
  const tt = labels(a),
    uu = labels(b);
  expect(uu.map(text)).toEqual(tt.map(text));
  for (let i = 0; i < tt.length; i++) {
    let expected = a.sum - Number(attr(tt[i], coordinate));
    if (a.bar && !categories.includes(text(tt[i]))) {
      // The text baseline remains upright. Preserve its offset from the
      // corresponding bar center rather than reflecting the glyph baseline.
      const matching = aa
        .map((e, index) => ({ e, index }))
        .filter(({ e }) => attr(e, "fill") === colors[0])
        .sort(
          (left, right) =>
            Math.abs(
              Number(attr(left.e, "y")) +
                Number(attr(left.e, "height")) / 2 -
                Number(attr(tt[i], "y")),
            ) -
            Math.abs(
              Number(attr(right.e, "y")) +
                Number(attr(right.e, "height")) / 2 -
                Number(attr(tt[i], "y")),
            ),
        )[0];
      const oldCenter =
        Number(attr(matching.e, "y")) + Number(attr(matching.e, "height")) / 2;
      const copied = bb[matching.index];
      const newCenter =
        Number(attr(copied, "y")) + Number(attr(copied, "height")) / 2;
      expected = newCenter + Number(attr(tt[i], "y")) - oldCenter;
    }
    if (
      !a.bar &&
      !categories.includes(text(tt[i])) &&
      attr(tt[i], "text-anchor") === "start"
    ) {
      // Automatic line labels remain on the screen-right side of their
      // point. Reversing categories moves the point, not that text offset.
      const before = points(pp[0]),
        after = points(qq[0]),
        x = Number(attr(tt[i], "x")),
        y = Number(attr(tt[i], "y"));
      let nearest = 0;
      for (let j = 2; j < before.length; j += 2)
        if (
          Math.hypot(before[j] - x, before[j + 1] - y) <
          Math.hypot(before[nearest] - x, before[nearest + 1] - y)
        )
          nearest = j;
      expected = after[nearest] + x - before[nearest];
      expect(attr(uu[i], "text-anchor")).toBe("start");
    }
    expect(Number(attr(uu[i], coordinate))).toBeCloseTo(expected, 1);
    expect(attr(uu[i], other)).toBe(attr(tt[i], other));
    expect(attr(uu[i], "transform")).toBeNull();
  }
  const ticks = (r) =>
    r.elements.filter(
      (e) =>
        e.name.localName === "line" &&
        attr(e, "stroke") === axisColor &&
        (a.bar
          ? attr(e, "y1") === attr(e, "y2")
          : attr(e, "x1") === attr(e, "x2")),
    );
  const ss = ticks(a),
    vv = ticks(b);
  expect(vv).toHaveLength(ss.length);
  for (let i = 0; i < ss.length; i++)
    expect(Number(attr(vv[i], coordinate + "1"))).toBeCloseTo(
      a.sum - Number(attr(ss[i], coordinate + "1")),
      1,
    );
}
describe("native category-axis plotting order", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const grouping of ["clustered", "stacked", "percentStacked"])
      it(`${kind} ${grouping} reverses coordinates, marks and readable labels without reversing model data`, () => {
        const f = fixture(kind, {
            grouping,
            series: [
              {
                name: "Units",
                color: colors[0],
                values: [2, 7, 3, 5, 1],
                dataLabels: { showValue: true },
              },
              { name: "Prior", color: colors[1], values: [1, 4, 2, 6, 3] },
            ],
          }),
          original = render(f),
          spec = P.getShapeChartSpec(f.shape),
          originalWorkbook = unzipSync(workbook(f.p, f.shape).data);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...spec,
          categoryAxisOrientation: "maxMin",
        });
        const before = f.part.data.slice();
        reflect(original, render(f));
        expect(P.getShapeChartSpec(f.shape).series).toEqual(spec.series);
        expect(P.getShapeChartSpec(f.shape).categories).toEqual(categories);
        expect(unzipSync(workbook(f.p, f.shape).data)).toEqual(
          originalWorkbook,
        );
        expect(f.part.data).toEqual(before);
      });
  it.each(["bar", "column", "line", "area"])(
    "%s retains identical rendering for an omitted or explicit minMax direction",
    (kind) => {
      const f = fixture(kind),
        original = render(f).svg;
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...P.getShapeChartSpec(f.shape),
        categoryAxisOrientation: undefined,
      });
      expect(render(f).svg).toBe(original);
    },
  );
  it.each(["line", "column"])(
    "%s retains logical blank/cache indices and fallback labels when reversed",
    (kind) => {
      const f = fixture(kind, {
          categories: ["Named"],
          series: [
            { name: "Units", color: colors[0], values: [2, null, 3, 5, null] },
          ],
          categoryAxisTickLabelSkip: 1,
        }),
        a = render(f);
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...P.getShapeChartSpec(f.shape),
        categoryAxisOrientation: "maxMin",
      });
      reflect(a, render(f));
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        2,
        null,
        3,
        5,
        null,
      ]);
    },
  );
  it.each(["column", "line"])(
    "%s reverses trendline forecasts along the logical category direction",
    (kind) => {
      const f = fixture(kind, {
          series: [
            {
              name: "Units",
              color: colors[0],
              values: [2, 4, 6, 8, 10],
              trendline: { type: "linear", forward: 2, backward: 1 },
            },
          ],
        }),
        a = render(f);
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...P.getShapeChartSpec(f.shape),
        categoryAxisOrientation: "maxMin",
      });
      reflect(a, render(f));
    },
  );
  it("reverses smooth line control points, markers, drop and hi-low lines with their points", () => {
    const f = fixture("line", {
        lineMarkers: true,
        dropLines: true,
        hiLowLines: true,
        series: [
          {
            name: "Units",
            color: colors[0],
            values: [2, 7, 3, 5, 1],
            smooth: true,
            markerSymbol: "circle",
          },
          { name: "Prior", color: colors[1], values: [1, 4, 2, 6, 3] },
        ],
      }),
      a = render(f);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...P.getShapeChartSpec(f.shape),
      categoryAxisOrientation: "maxMin",
    });
    const b = render(f);
    reflect(a, b);
    for (const tag of ["circle", "line"]) {
      const filter = (r) =>
        r.elements.filter(
          (e) =>
            e.name.localName === tag &&
            (tag === "circle"
              ? colors.includes(attr(e, "fill"))
              : ["#9CA3AF", "#4B5563"].includes(attr(e, "stroke"))),
        );
      const aa = filter(a),
        bb = filter(b);
      expect(bb).toHaveLength(aa.length);
      for (let i = 0; i < aa.length; i++) {
        const x = tag === "circle" ? "cx" : "x1";
        expect(Number(attr(bb[i], x))).toBeCloseTo(
          a.sum - Number(attr(aa[i], x)),
          1,
        );
      }
    }
  });
  for (const primary of ["minMax", "maxMin"])
    for (const secondary of ["minMax", "maxMin"])
      it(`mixed chart uses independent primary ${primary} and secondary ${secondary} category axes`, () => {
        const f = fixture("column", {
            categoryAxisOrientation: primary,
            secondaryCategoryAxisOrientation: secondary,
            series: [
              { name: "Columns", color: colors[0], values: [2, 7] },
              {
                name: "Line",
                color: colors[1],
                values: [10, 20, 30, 40, 50],
                chartKind: "line",
                secondaryAxis: true,
              },
            ],
          }),
          s = P.getShapeChartSpec(f.shape);
        expect(s.secondaryCategoryAxisOrientation).toBe(secondary);
        const r = render(f),
          rects = r.elements.filter(
            (e) => e.name.localName === "rect" && attr(e, "fill") === colors[0],
          ),
          line = paths(r).find((e) => attr(e, "stroke") === colors[1]),
          xs = points(line).filter((_, i) => i % 2 === 0);
        expect(Number(attr(rects[0], "x")) < Number(attr(rects[1], "x"))).toBe(
          primary === "minMax",
        );
        expect(xs[0] < xs.at(-1)).toBe(secondary === "minMax");
      });
  it("keeps an omitted secondary orientation independent of the reversed primary axis", () => {
    const f = fixture("column", {
      categoryAxisOrientation: "maxMin",
      series: [
        { name: "Columns", color: colors[0], values: [2, 7, 3, 5, 1] },
        {
          name: "Line",
          color: colors[1],
          values: [10, 20, 30, 40, 50],
          chartKind: "line",
          secondaryAxis: true,
        },
      ],
    });
    const r = render(f),
      line = paths(r).find((e) => attr(e, "stroke") === colors[1]),
      xs = points(line).filter((_, i) => i % 2 === 0);
    expect(xs[0]).toBeLessThan(xs.at(-1));
  });
  it("resolves category axes by plot-group IDs even when a hidden secondary axis is first", () => {
    const f = fixture("column", {
      categoryAxisOrientation: "maxMin",
      secondaryCategoryAxisOrientation: "minMax",
      series: [
        { name: "Columns", values: [2, 7] },
        {
          name: "Line",
          values: [10, 20, 30, 40, 50],
          chartKind: "line",
          secondaryAxis: true,
        },
      ],
    });
    editXml(f, (plot) => {
      const axes = allChildElements(plot, qname("", "catAx", NS.chart));
      plot.children = plot.children.filter((c) => !axes.includes(c));
      plot.children.push(axes[1], axes[0]);
    });
    const before = f.part.data.slice(),
      s = P.getShapeChartSpec(f.shape);
    expect(s.categoryAxisOrientation).toBe("maxMin");
    expect(s.secondaryCategoryAxisOrientation).toBe("minMax");
    expect(s.categoryAxisHidden).not.toBe(true);
    expect(f.part.data).toEqual(before);
  });
  it.each(["catAx", "valAx"])(
    "%s resolves a present empty orientation to the schema minMax default",
    (name) => {
      const f = fixture();
      editXml(f, (plot) => {
        const o = child(child(child(plot, name), "scaling"), "orientation");
        o.attrs = [];
      });
      expect(
        P.getShapeChartSpec(f.shape)[
          name === "catAx" ? "categoryAxisOrientation" : "valueAxisOrientation"
        ],
      ).toBe("minMax");
    },
  );
  it("preserves independent native category orientations through transfer both ways, export and edits", async () => {
    const f = fixture("column", {
        categoryAxisOrientation: "maxMin",
        secondaryCategoryAxisOrientation: "maxMin",
        series: [
          { name: "Columns", color: colors[0], values: [2, 7] },
          {
            name: "Line",
            color: colors[1],
            values: [10, 20, 30, 40, 50],
            chartKind: "line",
            secondaryAxis: true,
          },
        ],
      }),
      before = f.part.data.slice(),
      q = createDeck("blank"),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
    for (const s of [f.slide, to, back]) {
      const spec = P.getSlideCharts(s)[0].spec;
      expect([
        spec.categoryAxisOrientation,
        spec.secondaryCategoryAxisOrientation,
      ]).toEqual(["maxMin", "maxMin"]);
    }
    expect(preview(q, to)).toBe(preview(f.p, f.slide));
    const copied = P.getSlideCharts(back)[0];
    P.setChartSpec(copied, {
      ...copied.spec,
      categoryAxisOrientation: "minMax",
      secondaryCategoryAxisOrientation: "minMax",
    });
    expect(f.part.data).toEqual(before);
    const reopened = await P.loadPresentation(await P.savePresentation(f.p)),
      edited = P.getSlideCharts(P.getSlides(reopened).at(-1))[0];
    expect([
      edited.spec.categoryAxisOrientation,
      edited.spec.secondaryCategoryAxisOrientation,
    ]).toEqual(["minMax", "minMax"]);
    expect(P.validatePresentation(reopened)).toEqual([]);
  });
  it.each(["bar", "column"])(
    "%s reverses signed-value geometry while retaining signs and logical data",
    (kind) => {
      const f = fixture(kind, {
          series: [
            {
              name: "Units",
              color: colors[0],
              values: [-2, 7, -3, 5, 1],
              dataLabels: { showValue: true },
            },
          ],
        }),
        a = render(f);
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...P.getShapeChartSpec(f.shape),
        categoryAxisOrientation: "maxMin",
      });
      reflect(a, render(f));
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        -2, 7, -3, 5, 1,
      ]);
    },
  );
  it.each(["bar", "column"])(
    "%s keeps single-category geometry centered and handles an empty domain",
    (kind) => {
      for (const values of [[7], []]) {
        const f = fixture(kind, {
            categories: values.length ? ["North"] : [],
            series: [{ name: "Units", color: colors[0], values }],
            categoryAxisMajorTickMark: "none",
          }),
          a = render(f);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...P.getShapeChartSpec(f.shape),
          categoryAxisOrientation: "maxMin",
        });
        const b = render(f);
        if (values.length) reflect(a, b);
        else {
          const labels = (r) =>
            r.elements.filter(
              (e) => e.name.localName === "text" && text(e) === "1",
            );
          expect(labels(a)).toHaveLength(1);
          expect(labels(b)).toHaveLength(1);
          const coordinate = kind === "bar" ? "y" : "x";
          expect(Number(attr(labels(b)[0], coordinate))).toBeCloseTo(
            a.sum - Number(attr(labels(a)[0], coordinate)),
            1,
          );
          expect(a.svg + b.svg).not.toMatch(/NaN|Infinity/);
        }
      }
    },
  );
  it("keeps invalid and foreign orientation metadata distinct from the default without rewriting native XML", () => {
    for (const raw of ["MAXMIN", "", "invalid"]) {
      const f = fixture();
      editXml(f, (plot) => {
        const o = child(child(child(plot, "catAx"), "scaling"), "orientation");
        o.attrs[0].value = raw;
      });
      const before = f.part.data.slice();
      expect(
        P.getShapeChartSpec(f.shape).categoryAxisOrientation,
      ).toBeUndefined();
      expect(f.part.data).toEqual(before);
    }
    const f = fixture();
    editXml(f, (plot) => {
      child(
        child(child(plot, "catAx"), "scaling"),
        "orientation",
      ).name.namespaceURI = "urn:foreign";
    });
    expect(
      P.getShapeChartSpec(f.shape).categoryAxisOrientation,
    ).toBeUndefined();
  });
  it.each(["categoryAxisOrientation", "secondaryCategoryAxisOrientation"])(
    "rejects invalid authored %s before package mutation",
    (key) => {
      const f = fixture(),
        chart = P.getSlideCharts(f.slide)[0],
        pkg = P._internalPackageOf(f.p),
        before = pkg.parts.map((p) => [p.name, p.data.slice()]);
      for (const invalid of ["MAXMIN", "", 0, null]) {
        const spec = { ...chart.spec, [key]: invalid };
        expect(() => P.setChartSpec(chart, spec)).toThrow(key);
        expect(() =>
          P.addSlideChart(f.slide, {
            x: P.inches(1),
            y: P.inches(1),
            w: P.inches(3),
            h: P.inches(3),
            spec,
          }),
        ).toThrow(key);
        expect(pkg.parts.map((p) => [p.name, p.data])).toEqual(before);
      }
    },
  );
  it("retains a lone right-side value axis as primary rather than inventing a secondary chart pair", () => {
    const f = fixture("column", { categoryAxisOrientation: "maxMin" });
    editXml(f, (plot) => {
      child(child(plot, "valAx"), "axPos").attrs[0].value = "r";
    });
    const before = f.part.data.slice(),
      spec = P.getShapeChartSpec(f.shape);
    expect(spec.series[0].secondaryAxis).toBeUndefined();
    expect(spec.secondaryCategoryAxisOrientation).toBeUndefined();
    expect(spec.categoryAxisOrientation).toBe("maxMin");
    expect(f.part.data).toEqual(before);
  });
  it.each(["l", "r"])(
    "automatic %s-aligned label gutters follow the physical edges after reversing a skipped category domain",
    (align) => {
      const f = fixture("column", {
          categories: Array.from(
            { length: 5 },
            (_, i) => `category of unit data ${i}`,
          ),
          categoryAxisLabelRotationDeg: null,
          categoryAxisLabelAlign: align,
          categoryAxisTickLabelSkip: 3,
        }),
        a = render(f);
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...P.getShapeChartSpec(f.shape),
        categoryAxisOrientation: "maxMin",
      });
      const b = render(f),
        spine = (r) =>
          r.elements.find(
            (e) =>
              e.name.localName === "line" &&
              attr(e, "stroke") === axisColor &&
              attr(e, "y1") === attr(e, "y2"),
          );
      if (align === "l")
        expect(Number(attr(spine(b), "x2"))).toBeLessThan(
          Number(attr(spine(a), "x2")),
        );
      else
        expect(Number(attr(spine(b), "x1"))).toBeLessThan(
          Number(attr(spine(a), "x1")),
        );
      const labels = b.elements.filter(
        (e) => e.name.localName === "text" && text(e).startsWith("category of"),
      );
      expect(labels.map(text)).toEqual([
        "category of unit data 0",
        "category of unit data 3",
      ]);
      expect(Number(attr(labels[0], "x"))).toBeGreaterThan(
        Number(attr(labels[1], "x")),
      );
    },
  );
});
