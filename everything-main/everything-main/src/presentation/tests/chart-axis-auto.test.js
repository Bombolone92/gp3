import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const bytes = (s) => new TextEncoder().encode(s);
const measure = (text, font) => ({
  widthPx: [...text].length * font.sizePx * 0.6,
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.2,
});
function fixture({
  kind = "bar",
  categories = ["First category", "Second category", "Third category"],
  w = 700,
  h = 360,
  ...spec
} = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.emu(100 * 9525),
      y: P.emu(80 * 9525),
      w: P.emu(w * 9525),
      h: P.emu(h * 9525),
      spec: {
        kind,
        categories,
        series: [{ name: "Units", values: categories.map((_, i) => i + 1) }],
        categoryAxisLabelStyle: { sizePt: 12 },
        valueAxisLabelStyle: { sizePt: 12 },
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
function native(f, category = "-60000000", value = "-60000000") {
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    plot = child(child(doc.root, "chart"), "plotArea");
  for (const [n, rotation] of [
    ["catAx", category],
    ["valAx", value],
  ]) {
    const body = child(child(child(plot, n), "txPr"), "bodyPr", NS.dml);
    body.attrs = body.attrs.filter((a) => a.name.localName !== "rot");
    if (rotation !== undefined)
      body.attrs.push({ name: qname("", "rot", ""), value: rotation });
  }
  f.part.data = bytes(serializeXml(doc));
}
function svgTexts(f) {
  const nodes = [];
  walkElements(
    parseXml(renderSlideToSvg(f.p, f.slide, { measureText: measure })).root,
    (e) => {
      if (e.name.localName === "text") nodes.push(e);
    },
  );
  return nodes;
}
const textOf = (e) =>
  e.children
    .filter((c) => c.kind === "text")
    .map((c) => c.data)
    .join("");
const attrOf = (e, name) =>
  e.attrs.find((a) => a.name.localName === name)?.value;
describe("complete category text with authored chart label angles", () => {
  const categories = [
    "International operating income after tax",
    "ABCDEFGHIJKLé👩‍👩‍👧‍👦 annual totals",
    'R&D <net> "quoted" proceeds 🚀',
  ];
  for (const kind of ["bar", "column", "line", "area"])
    for (const angle of [undefined, null, -90, -45, -27.5, 0, 15, 30, 90])
      it(`${kind} retains complete text at ${String(angle)} degrees`, () => {
        const f = fixture({
            kind,
            categories,
            w: 1100,
            h: 600,
            categoryAxisLabelStyle: { sizePt: 12, color: "#604020" },
            categoryAxisLabelRotationDeg: angle,
          }),
          before = f.part.data.slice(),
          labels = svgTexts(f).filter((e) => attrOf(e, "fill") === "#604020");
        expect(labels.map(textOf)).toEqual(categories);
        expect(f.part.data).toEqual(before);
        for (const label of labels) {
          expect(Number.isFinite(Number(attrOf(label, "x")))).toBe(true);
          expect(Number.isFinite(Number(attrOf(label, "y")))).toBe(true);
          if (angle != null)
            expect(attrOf(label, "transform")).toBe(
              angle
                ? `rotate(${angle} ${attrOf(label, "x")} ${attrOf(label, "y")})`
                : undefined,
            );
        }
      });
  for (const kind of ["bar", "column", "line", "area"])
    it(`${kind} retains long visible labels while honoring skip and hidden states`, () => {
      const f = fixture({
          kind,
          categories: [categories[0], "", categories[1], categories[2]],
          categoryAxisTickLabelSkip: 2,
          categoryAxisLabelRotationDeg: 0,
          categoryAxisLabelStyle: { color: "#604020" },
        }),
        labels = () =>
          svgTexts(f)
            .filter((e) => attrOf(e, "fill") === "#604020")
            .map(textOf);
      expect(labels()).toEqual(categories.slice(0, 2));
      const c = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(c, { ...c.spec, categoryAxisTickLabelPos: "none" });
      expect(labels()).toEqual([]);
      P.setChartSpec(c, {
        ...P.getShapeChartSpec(f.shape),
        categoryAxisTickLabelPos: "low",
        categoryAxisHidden: true,
      });
      expect(labels()).toEqual([]);
    });
});
describe("native automatic chart axis-label orientation", () => {
  it("reads native automatic orientation separately from explicit angles without mutation", () => {
    const f = fixture();
    native(f);
    const before = f.part.data.slice(),
      spec = P.getShapeChartSpec(f.shape);
    expect(spec.categoryAxisLabelRotationDeg).toBeNull();
    expect(spec.valueAxisLabelRotationDeg).toBeNull();
    expect(P.getSlideCharts(f.slide)[0].spec).toEqual(spec);
    expect(f.part.data).toEqual(before);
  });
  it.each([-90, -27.5, 0, 33.75, 90])(
    "retains explicit %s-degree angles",
    (angle) => {
      const f = fixture();
      native(f, String(angle * 60000), String(-angle * 60000));
      expect(P.getShapeChartSpec(f.shape).categoryAxisLabelRotationDeg).toBe(
        angle,
      );
      expect(P.getShapeChartSpec(f.shape).valueAxisLabelRotationDeg).toBe(
        angle === 0 ? 0 : -angle,
      );
    },
  );
  it("authors and edits automatic orientation as native ChartML", async () => {
    const f = fixture({
      categoryAxisLabelRotationDeg: null,
      valueAxisLabelRotationDeg: null,
    });
    expect(
      new TextDecoder().decode(f.part.data).match(/rot="-60000000"/g),
    ).toHaveLength(2);
    const loaded = await P.loadPresentation(await P.savePresentation(f.p)),
      spec = P.getSlideCharts(P.getSlides(loaded)[0])[0].spec;
    expect(spec.categoryAxisLabelRotationDeg).toBeNull();
    expect(spec.valueAxisLabelRotationDeg).toBeNull();
    P.setChartSpec(
      { shape: f.shape, spec },
      { ...spec, categoryAxisLabelRotationDeg: 32 },
    );
    expect(P.getShapeChartSpec(f.shape).categoryAxisLabelRotationDeg).toBe(32);
    expect(P.getShapeChartSpec(f.shape).valueAxisLabelRotationDeg).toBeNull();
  });
  it("keeps fitting bar labels horizontal, complete and within the chart gutter", () => {
    const f = fixture();
    native(f);
    const labels = svgTexts(f).filter((e) => textOf(e).includes("category"));
    expect(labels.map(textOf)).toEqual([
      "First category",
      "Second category",
      "Third category",
    ]);
    for (const e of labels) {
      expect(attrOf(e, "transform")).toBeUndefined();
      expect(
        Number(attrOf(e, "x")) - measure(textOf(e), { sizePx: 16 }).widthPx,
      ).toBeGreaterThanOrEqual(100);
    }
    expect(
      svgTexts(f).some((e) => attrOf(e, "transform")?.includes("-1000")),
    ).toBe(false);
  });
  it("keeps fitting column labels horizontal and resolves crowded labels from measured extents", () => {
    const fitting = fixture({ kind: "column", categories: ["A", "B", "C"] });
    native(fitting);
    expect(
      svgTexts(fitting)
        .filter((e) => ["A", "B", "C"].includes(textOf(e)))
        .every((e) => !attrOf(e, "transform")),
    ).toBe(true);
    const crowded = fixture({
      kind: "column",
      w: 360,
      h: 500,
      categories: [
        "Long first category",
        "Long second category",
        "Long third category",
        "Long fourth category",
      ],
    });
    native(crowded);
    const labels = svgTexts(crowded).filter((e) =>
      textOf(e).includes("category"),
    );
    expect(labels).toHaveLength(4);
    const angles = labels.map((e) =>
      Number(/rotate\(([-.\d]+)/.exec(attrOf(e, "transform"))[1]),
    );
    expect(angles.every((a) => a < 0 && a >= -90)).toBe(true);
    expect(new Set(angles).size).toBe(1);
    expect(labels.every((e) => attrOf(e, "text-anchor") === "end")).toBe(true);
  });
  it.each([
    ["l", "start"],
    ["r", "end"],
    ["ctr", "middle"],
  ])(
    "honors authored %s alignment while reserving the projected label extent",
    (align, anchor) => {
      const f = fixture({
        kind: "column",
        w: 360,
        h: 500,
        categories: [
          "An extended first category",
          "An extended second category",
          "An extended third category",
        ],
        categoryAxisLabelAlign: align,
      });
      native(f);
      const svg = parseXml(
        renderSlideToSvg(f.p, f.slide, { measureText: measure }),
      ).root;
      const texts = [],
        lines = [];
      walkElements(svg, (e) => {
        if (e.name.localName === "text" && textOf(e).includes("category"))
          texts.push(e);
        if (e.name.localName === "line" && attrOf(e, "y1") === attrOf(e, "y2"))
          lines.push(e);
      });
      const baseline = lines.sort(
        (a, b) =>
          Math.abs(Number(attrOf(b, "x2")) - Number(attrOf(b, "x1"))) -
          Math.abs(Number(attrOf(a, "x2")) - Number(attrOf(a, "x1"))),
      )[0];
      for (const e of texts) {
        expect(attrOf(e, "text-anchor")).toBe(anchor);
        const angle =
          (Math.abs(
            Number(/rotate\(([-.\d]+)/.exec(attrOf(e, "transform"))[1]),
          ) *
            Math.PI) /
          180;
        const width = measure(textOf(e), { sizePx: 16 }).widthPx,
          height = 16;
        const above =
          anchor === "start"
            ? width * Math.sin(angle) + (height / 2) * Math.cos(angle)
            : anchor === "middle"
              ? (width * Math.sin(angle) + height * Math.cos(angle)) / 2
              : (height / 2) * Math.cos(angle);
        const projection = width * Math.cos(angle),
          halfHeight = (height / 2) * Math.sin(angle);
        const left =
          (anchor === "end"
            ? projection
            : anchor === "middle"
              ? projection / 2
              : 0) + halfHeight;
        const right =
          (anchor === "start"
            ? projection
            : anchor === "middle"
              ? projection / 2
              : 0) + halfHeight;
        expect(Number(attrOf(e, "x")) - left).toBeGreaterThanOrEqual(100 - 0.1);
        expect(Number(attrOf(e, "x")) + right).toBeLessThanOrEqual(460 + 0.1);
        expect(Number(attrOf(e, "y")) - above).toBeGreaterThanOrEqual(
          Number(attrOf(baseline, "y1")) - 0.1,
        );
      }
    },
  );
  it("resolves omitted orientation automatically while preserving native omission and explicit zero", () => {
    const f = fixture({
      categories: [
        "A complete, unabridged category",
        "Another complete category",
      ],
    });
    const before = f.part.data.slice();
    expect(
      P.getShapeChartSpec(f.shape).categoryAxisLabelRotationDeg,
    ).toBeUndefined();
    expect(svgTexts(f).map(textOf)).toContain(
      "A complete, unabridged category",
    );
    expect(f.part.data).toEqual(before);
    const explicit = fixture({
      kind: "column",
      w: 200,
      categoryAxisLabelRotationDeg: 0,
    });
    expect(
      svgTexts(explicit)
        .filter((e) => textOf(e).includes("category"))
        .every((e) => !attrOf(e, "transform")),
    ).toBe(true);
    expect(
      P.getShapeChartSpec(explicit.shape).categoryAxisLabelRotationDeg,
    ).toBe(0);
  });
  it("centers a single category and preserves complete Unicode text", () => {
    const f = fixture({ kind: "column", categories: ["売上高 — café 🚀"] });
    native(f);
    const text = svgTexts(f).find((e) => textOf(e) === "売上高 — café 🚀");
    expect(text).toBeDefined();
    // The plot center is also the center of the lone rendered column.
    const nodes = [];
    walkElements(
      parseXml(renderSlideToSvg(f.p, f.slide, { measureText: measure })).root,
      (e) => {
        if (e.name.localName === "rect" && attrOf(e, "fill") !== "#FFFFFF")
          nodes.push(e);
      },
    );
    const bar = nodes.find(
      (e) =>
        Number(attrOf(e, "height")) > 0 && Number(attrOf(e, "width")) < 700,
    );
    expect(Number(attrOf(text, "x"))).toBeCloseTo(
      Number(attrOf(bar, "x")) + Number(attrOf(bar, "width")) / 2,
      1,
    );
  });
  it("measures only visible categories and honors authored label skipping", () => {
    const f = fixture({
      kind: "column",
      w: 360,
      categories: [
        "A",
        "A very long hidden category",
        "B",
        "Another long hidden category",
      ],
      categoryAxisTickLabelSkip: 2,
    });
    native(f);
    const labels = svgTexts(f).map(textOf);
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels).not.toContain("A very long hidden category");
    expect(
      svgTexts(f)
        .filter((e) => ["A", "B"].includes(textOf(e)))
        .every((e) => !attrOf(e, "transform")),
    ).toBe(true);
    P.setChartSpec(
      { shape: f.shape, spec: P.getShapeChartSpec(f.shape) },
      { ...P.getShapeChartSpec(f.shape), categoryAxisHidden: true },
    );
    expect(svgTexts(f).map(textOf)).not.toContain("A");
  });
  it("uses formatted horizontal value extents and retains every tick", () => {
    const f = fixture({
      w: 700,
      h: 500,
      valueAxis: {
        min: 0,
        max: 100000,
        majorUnit: 20000,
        numberFormat: "$#,##0.00",
      },
    });
    native(f);
    const before = f.part.data.slice(),
      texts = svgTexts(f).filter((e) => textOf(e).startsWith("$"));
    expect(texts.map(textOf)).toEqual([
      "$0.00",
      "$20,000.00",
      "$40,000.00",
      "$60,000.00",
      "$80,000.00",
      "$100,000.00",
    ]);
    for (const e of texts) {
      const angle =
        (Math.abs(
          Number(
            /rotate\(([-.\d]+)/.exec(attrOf(e, "transform") ?? "rotate(0")[1],
          ),
        ) *
          Math.PI) /
        180;
      const w = measure(textOf(e), { sizePx: 16 }).widthPx;
      const left =
        attrOf(e, "text-anchor") === "end"
          ? w * Math.cos(angle) + 8 * Math.sin(angle)
          : w / 2;
      expect(Number(attrOf(e, "x")) - left).toBeGreaterThanOrEqual(100 - 0.1);
      expect(
        Number(attrOf(e, "y")) + w * Math.sin(angle) + 8 * Math.cos(angle),
      ).toBeLessThanOrEqual(580 + 0.1);
    }
    expect(f.part.data).toEqual(before);
  });
  it("measures fallback labels when category cache entries are missing", () => {
    const f = fixture({
      kind: "column",
      categoryAxisLabelStyle: { sizePt: 30 },
      series: [{ name: "Units", values: [1, 2, 3] }],
    });
    native(f);
    // Native charts may omit c:cat while retaining the series' c:val cache.
    const doc = parseXml(new TextDecoder().decode(f.part.data));
    const series = child(
      child(child(child(doc.root, "chart"), "plotArea"), "barChart"),
      "ser",
    );
    series.children = series.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.chart ||
        e.name.localName !== "cat",
    );
    f.part.data = bytes(serializeXml(doc));
    expect(P.getShapeChartSpec(f.shape).categories).toEqual([]);
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([1, 2, 3]);
    const measured = [];
    renderSlideToSvg(f.p, f.slide, {
      measureText: (text, font) => {
        if (font.sizePx === 40) measured.push(text);
        return measure(text, font);
      },
    });
    expect(measured).toContain("1");
    expect(measured).toContain("2");
    expect(measured).toContain("3");
    expect(
      svgTexts(f).filter((e) => ["1", "2", "3"].includes(textOf(e))).length,
    ).toBeGreaterThanOrEqual(3);
  });
  it("reserves category-title space below inclined labels", () => {
    const f = fixture({
      kind: "column",
      w: 360,
      h: 500,
      categories: [
        "A complete first category",
        "A complete second category",
        "A complete third category",
      ],
      categoryAxisTitle: "Categories",
      categoryAxisTitleStyle: { sizePt: 18 },
    });
    native(f);
    const texts = svgTexts(f),
      title = texts.find((e) => textOf(e) === "Categories");
    const bottom = Math.max(
      ...texts
        .filter((e) => textOf(e).includes("category"))
        .map((e) => {
          const angle =
            (Math.abs(
              Number(/rotate\(([-.\d]+)/.exec(attrOf(e, "transform"))[1]),
            ) *
              Math.PI) /
            180;
          return (
            Number(attrOf(e, "y")) +
            measure(textOf(e), { sizePx: 16 }).widthPx * Math.sin(angle) +
            8 * Math.cos(angle)
          );
        }),
    );
    expect(Number(attrOf(title, "y")) - 12).toBeGreaterThan(bottom);
    expect(Number(attrOf(title, "y")) + 12).toBeLessThanOrEqual(580);
  });
  it("preserves automatic orientation through export and both native transfer directions", async () => {
    const f = fixture();
    native(f);
    const q = createDeck("blank"),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
    const spec = P.getSlideCharts(to)[0].spec;
    expect(spec.categoryAxisLabelRotationDeg).toBeNull();
    expect(spec.valueAxisLabelRotationDeg).toBeNull();
    const loaded = await P.loadPresentation(await P.savePresentation(q)),
      back = P.importSlide(
        f.p,
        P.getSlides(loaded).at(-1),
        P.getSlideLayout(f.slide),
        { preservePaintFormatting: true, preserveTextFormatting: true },
      );
    expect(P.getSlideCharts(back)[0].spec).toEqual(
      P.getShapeChartSpec(f.shape),
    );
    expect(P.validatePresentation(loaded)).toEqual([]);
  });
});
