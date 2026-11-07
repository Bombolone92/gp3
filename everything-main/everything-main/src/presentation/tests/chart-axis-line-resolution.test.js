import { expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartAxisLineDeck,
  axisLineModes,
  chartLineTheme,
} from "./chart-axis-line-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { chartAxisGridDeck } from "./chart-axis-grid-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  getAttrValue,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, "")),
  child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const view = (f) => chartRenderingView(f.shape).axisLines;
const elements = (f) => {
  const a = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) => a.push(e));
  return a;
};
const strokes = (f) => elements(f).filter((e) => e.name.localName === "line");
const make = (target, mode, options = {}) =>
  chartAxisLineDeck({
    ...(target === "major"
      ? { grids: { value: axisLineModes[mode] } }
      : { lines: { [target]: axisLineModes[mode] } }),
    valueAxisMajorGridlines: target === "major",
    ...options,
  });
const line = (f, target) =>
  target === "major" ? view(f).value.majorGridline : view(f)[target].line;
for (const variant of [undefined, "office2010"])
  for (let style = 1; style <= 48; style++)
    it(`${variant ?? "legacy"} ${style} binds the independent minor-grid style color before theme transforms`, () => {
      // ECMA-376 21.2.3.46 table 2 / MS-ODRAWXML 2.7.4.1:
      // explicit ChartML is the reference for the automatic style binding.
      const color = variant && style > 32 ? "dk1" : "tx1",
        tint = style > 40 ? 90000 : 50000,
        options = { style, variant, themeLine: chartLineTheme },
        automatic = chartAxisGridDeck({
          ...options,
          axes: { value: { minor: true } },
        }),
        explicit = chartAxisGridDeck({
          ...options,
          axes: {
            value: {
              minor: `<a:ln><a:solidFill><a:schemeClr val="${color}"><a:tint val="${tint}"/><a:shade val="70000"/><a:alpha val="60000"/></a:schemeClr></a:solidFill></a:ln>`,
            },
          },
        }),
        before = automatic.part.data.slice();
      expect(view(automatic).value.minorGridline).toEqual(
        view(explicit).value.minorGridline,
      );
      expect(view(automatic).value.minorGridline.paint).not.toEqual(
        view(automatic).value.majorGridline.paint,
      );
      expect(
        P.getShapeChartSpec(automatic.shape).valueAxisMinorGridlineColor,
      ).toBeUndefined();
      expect(automatic.part.data).toEqual(before);
    });
for (const variant of [undefined, "office2010"])
  for (let style = 1; style <= 48; style++)
    it(`${variant ?? "legacy"} ${style} resolves native automatic axis and major-grid paint read-only`, () => {
      const f = chartAxisLineDeck({
          style,
          variant,
          valueAxisMajorGridlines: true,
        }),
        before = f.part.data.slice(),
        spec = P.getShapeChartSpec(f.shape),
        color = variant ? "#868686" : "#000000";
      for (const role of ["category", "value"])
        for (const prop of ["line", "majorGridline"])
          expect(view(f)[role][prop]).toEqual({
            paint: { kind: "solid", color, opacity: 1 },
            widthEmu: 9525,
            cap: "flat",
            dash: { kind: "preset", value: "solid" },
            join: { kind: "round" },
          });
      const paths = strokes(f);
      expect(paths.length).toBeGreaterThan(4);
      expect(
        paths.every(
          (e) => attr(e, "stroke") === color && attr(e, "stroke-width") === "1",
        ),
      ).toBe(true);
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
      expect(spec.valueAxisLineColor).toBeUndefined();
      expect(f.part.data).toEqual(before);
    });
it("omitted styles keep legacy automatic paint without authoring a style", () => {
  const f = chartAxisLineDeck();
  expect(view(f).value.line.paint).toEqual({
    kind: "solid",
    color: "#000000",
    opacity: 1,
  });
  expect(P.getShapeChartSpec(f.shape).chartStyle).toBeUndefined();
});
for (const target of ["category", "value", "major"])
  for (const themeOwner of ["layout", "slide", "chart"])
    for (const mode of [
      "automatic",
      "empty",
      "width",
      "color",
      "dash",
      "zero",
      "none",
      "solidEmpty",
    ])
      it(`${themeOwner} theme ${target} ${mode} cascades independent stroke properties`, () => {
        const f = make(target, mode, {
            style: 33,
            variant: "office2010",
            themeOwner,
            themeLine: chartLineTheme,
          }),
          before = f.part.data.slice(),
          v = line(f, target);
        expect(v.widthEmu).toBe(
          mode === "width" ? 76200 : mode === "zero" ? 0 : 57150,
        );
        expect(v.cap).toBe("rnd");
        expect(v.join).toEqual({ kind: "bevel" });
        expect(v.dash).toEqual({
          kind: "preset",
          value: mode === "dash" ? "dashDot" : "sysDot",
        });
        expect(v.paint).toEqual(
          mode === "none"
            ? { kind: "none" }
            : mode === "color"
              ? { kind: "solid", color: "#1B7CA3", opacity: 0.4 }
              : mode === "zero"
                ? { kind: "solid", color: "#1B7CA3", opacity: 1 }
                : { kind: "solid", color: "#76788D", opacity: 0.6 },
        );
        const es = strokes(f),
          expected = v.paint.kind === "none" ? "none" : v.paint.color;
        expect(
          es.some(
            (e) =>
              attr(e, "stroke") === expected &&
              +attr(e, "stroke-width") === v.widthEmu / 9525,
          ),
        ).toBe(true);
        if (mode === "color")
          expect(
            es
              .filter((e) => attr(e, "stroke") === expected)
              .every(
                (e) =>
                  attr(e, "stroke-opacity") === ".4" ||
                  +attr(e, "stroke-opacity") === 0.4,
              ),
          ).toBe(true);
        expect(f.part.data).toEqual(before);
      });
for (const style of [2, 33, 41])
  for (const variant of [undefined, "office2010"])
    it(`${variant ?? "legacy"} ${style} keeps theme lines even when the chart area has no theme outline`, () => {
      const f = chartAxisLineDeck({
        style,
        variant,
        themeLine: chartLineTheme,
      });
      expect(view(f).value.line.paint).toEqual({
        kind: "solid",
        color: variant ? "#76788D" : "#132561",
        opacity: 0.6,
      });
      expect(view(f).value.line.widthEmu).toBe(57150);
    });
for (const kind of ["bar", "column", "line", "area"])
  it(`${kind} uses explicit custom dash/cap/join for every axis and tick`, () => {
    const f = chartAxisLineDeck({
        kind,
        lines: { category: axisLineModes.custom, value: axisLineModes.custom },
      }),
      es = strokes(f);
    expect(es.length).toBeGreaterThan(3);
    for (const e of es) {
      expect(attr(e, "stroke")).toBe("#1B7CA3");
      expect(attr(e, "stroke-opacity")).toBe("0.4");
      expect(attr(e, "stroke-width")).toBe("4");
      expect(attr(e, "stroke-linecap")).toBe("square");
      expect(attr(e, "stroke-linejoin")).toBe("miter");
      expect(attr(e, "stroke-miterlimit")).toBe("3.5");
      expect(attr(e, "stroke-dasharray")).toBe("10 6");
    }
  });
for (const target of ["category", "value", "major"])
  for (const mode of ["gradient", "pattern"])
    it(`${target} ${mode} keeps paint and nonempty shared gradient bounds`, () => {
      const f = make(target, mode),
        v = line(f, target);
      expect(v.paint.kind).toBe(mode);
      const es = elements(f),
        painted = strokes(f).filter((e) =>
          attr(e, "stroke")?.startsWith("url(#"),
        );
      expect(painted.length).toBeGreaterThan(0);
      if (mode === "gradient") {
        const defs = es.filter((e) => e.name.localName === "linearGradient");
        expect(defs).toHaveLength(target === "major" ? 1 : 2);
        for (const d of defs) {
          expect(attr(d, "gradientUnits")).toBe("userSpaceOnUse");
          const t = attr(d, "gradientTransform");
          expect(t).toMatch(/^(translate\([\d.e+ -]+\) )?scale\([\d.e+ -]+\)$/);
          const dims = t
            .match(/scale\(([^)]+)\)/)[1]
            .split(" ")
            .map(Number);
          expect(dims.every((n) => n >= 8)).toBe(true);
        }
      }
      expect(
        P.getShapeChartSpec(f.shape)[
          target === "major"
            ? "valueAxisMajorGridlineColor"
            : `${target}AxisLineColor`
        ],
      ).toBeUndefined();
    });
for (const raw of ["-1", "garbage", "2x", "20116801"])
  it(`invalid width ${raw} inherits its theme instead of a display fallback`, () => {
    const f = chartAxisLineDeck({
      themeLine: chartLineTheme,
      lines: { value: `<a:ln w="${raw}"/>` },
    });
    expect(view(f).value.line.widthEmu).toBe(57150);
  });
it("foreign declarations do not shadow qualified axis properties", () => {
  const f = chartAxisLineDeck({
    themeLine: chartLineTheme,
    lines: {
      value:
        '<a:ln w="25400"><f:noFill xmlns:f="urn:foreign"/><f:prstDash xmlns:f="urn:foreign" val="dash"/></a:ln>',
    },
  });
  expect(view(f).value.line.paint.kind).toBe("solid");
  expect(view(f).value.line.widthEmu).toBe(25400);
  expect(view(f).value.line.dash.value).toBe("sysDot");
});
it("follows referenced primary/secondary systems across XML order, axis IDs and same-edge crossings", () => {
  const f = chartAxisLineDeck({
      lines: {
        value: axisLineModes.custom,
        category: axisLineModes.color,
        secondaryValue: axisLineModes.none,
      },
      series: [
        { name: "Primary", values: [2, 4] },
        {
          name: "Secondary",
          chartKind: "line",
          secondaryAxis: true,
          values: [20, 40],
        },
      ],
    }),
    expected = view(f),
    svg = preview(f.p, f.slide),
    doc = parseXml(new TextDecoder().decode(f.part.data)),
    area = child(child(doc.root, "chart"), "plotArea"),
    axes = area.children.filter(
      (e) =>
        e.kind === "element" && ["valAx", "catAx"].includes(e.name.localName),
    );
  area.children = area.children.filter((e) => !axes.includes(e));
  area.children.unshift(...axes.reverse());
  const map = new Map();
  walkElements(area, (e) => {
    if (
      e.name.namespaceURI === NS.chart &&
      ["axId", "crossAx"].includes(e.name.localName)
    ) {
      const a = e.attrs.find((a) => a.name.localName === "val");
      if (!map.has(a.value)) map.set(a.value, String(7000 + map.size * 61));
      a.value = map.get(a.value);
    }
  });
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  expect(view(f)).toEqual(expected);
  expect(preview(f.p, f.slide)).toBe(svg);
  expect(expected.secondaryValue.line.paint.kind).toBe("none");
});
for (const kind of ["scatter", "bubble"])
  it(`${kind} binds two numeric axis styles by physical role when axes are reversed in XML`, () => {
    const f = chartAxisLineDeck({
        lines: { category: axisLineModes.color, value: axisLineModes.custom },
      }),
      doc = parseXml(new TextDecoder().decode(f.part.data)),
      area = child(child(doc.root, "chart"), "plotArea"),
      cat = child(area, "catAx"),
      val = child(area, "valAx"),
      group = child(area, "barChart"),
      ser = child(group, "ser");
    group.name = qname("c", `${kind}Chart`, NS.chart);
    cat.name = qname("c", "valAx", NS.chart);
    for (const [from, to] of [
      ["cat", "xVal"],
      ["val", "yVal"],
    ])
      child(ser, from).name = qname("c", to, NS.chart);
    area.children = area.children.filter((e) => e !== cat && e !== val);
    area.children.push(val, cat);
    f.part.data = new TextEncoder().encode(serializeXml(doc));
    expect(P.getShapeChartSpec(f.shape).kind).toBe(kind);
    expect(view(f).category.line.widthEmu).toBe(9525);
    expect(view(f).value.line.widthEmu).toBe(38100);
    expect(view(f).category.line.paint.opacity).toBe(0.4);
    expect(strokes(f).some((e) => attr(e, "stroke-dasharray") === "10 6")).toBe(
      true,
    );
  });
for (const mode of ["color", "custom", "gradient", "pattern", "none"])
  it(`${mode} stays editable through native transfer both ways, data edits and reimport`, async () => {
    const f = chartAxisLineDeck({
        lines: { category: axisLineModes[mode], value: axisLineModes[mode] },
        grids: { value: axisLineModes[mode] },
        themeLine: chartLineTheme,
      }),
      original = f.part.data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      expected = view(f),
      q = createDeck("blank"),
      target = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, target, P.getSlideLayout(f.slide));
    for (const [p, s] of [
      [q, target],
      [f.p, back],
    ]) {
      const c = P.getSlideCharts(s)[0];
      expect(chartRenderingView(c.shape).axisLines).toEqual(expected);
      P.setChartSpec(c, {
        ...c.spec,
        series: c.spec.series.map((s) => ({ ...s, values: [7, 5] })),
      });
      expect(chartRenderingView(c.shape).axisLines).toEqual(expected);
      const r = await P.loadPresentation(await P.savePresentation(p)),
        d = P.getSlideCharts(P.getSlides(r).at(-1))[0];
      expect(d.spec.series[0].values).toEqual([7, 5]);
      expect(chartRenderingView(d.shape).axisLines).toEqual(expected);
      expect(P.validatePresentation(r)).toEqual([]);
    }
    expect(f.part.data).toEqual(original);
    expect(workbook(f.p, f.shape).data).toEqual(book);
  });
for (const themeOwner of ["layout", "slide", "chart"])
  for (const style of [2, 33])
    it(`${themeOwner} style ${style} binds tx1 through chart-local mappings while dk1 stays independent`, () => {
      const f = chartAxisLineDeck({
          style,
          themeOwner,
          themeLine:
            '<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>',
        }),
        pkg = P._internalPackageOf(f.p),
        theme = pkg.getPart("/ppt/theme/own-chart-paint.xml"),
        td = parseXml(new TextDecoder().decode(theme.data)),
        accent = child(child(td.root, "clrScheme", NS.dml), "accent1", NS.dml);
      accent.children = [
        parseXml(`<a:srgbClr xmlns:a="${NS.dml}" val="3C9A27"/>`).root,
      ];
      theme.data = new TextEncoder().encode(serializeXml(td));
      const doc = parseXml(new TextDecoder().decode(f.part.data));
      doc.root.children.unshift(
        parseXml(`<c:clrMapOvr xmlns:c="${NS.chart}" tx1="accent1"/>`).root,
      );
      f.part.data = new TextEncoder().encode(serializeXml(doc));
      expect(view(f).value.line.paint).toEqual({
        kind: "solid",
        color: style === 2 ? "#3C9A27" : "#182D73",
        opacity: 1,
      });
    });
it("style edits re-resolve automatic axes without turning inherited paint into authored formatting", () => {
  const f = chartAxisLineDeck({ style: 2 }),
    c = P.getSlideCharts(f.slide)[0];
  expect(view(f).value.line.paint.color).toBe("#000000");
  P.setChartSpec(c, { ...c.spec, chartStyleVariant: "office2010" });
  expect(view(f).value.line.paint.color).toBe("#868686");
  const spec = P.getShapeChartSpec(f.shape);
  expect(spec.valueAxisLineColor).toBeUndefined();
  expect(spec.valueAxisLineWidthEmu).toBeUndefined();
  P.setChartSpec(c, { ...spec, chartStyleVariant: undefined });
  expect(view(f).value.line.paint.color).toBe("#000000");
});
for (const style of [2, 33])
  for (const variant of [undefined, "office2010"])
    for (const themeLine of [
      "<a:ln/>",
      '<a:ln w="57150"/>',
      "<a:ln><a:noFill/></a:ln>",
    ])
      it(`${variant ?? "legacy"} ${style} theme ${themeLine} does not invent automatic axis/grid paint`, () => {
        const f = chartAxisLineDeck({
          style,
          variant,
          themeLine,
          valueAxisMajorGridlines: true,
        });
        expect(view(f).value.line.paint).toEqual({ kind: "none" });
        expect(view(f).category.line.paint).toEqual({ kind: "none" });
        expect(view(f).value.majorGridline.paint).toEqual({ kind: "none" });
        const paths = strokes(f);
        expect(paths.length).toBeGreaterThan(4);
        expect(paths.every((e) => attr(e, "stroke") === "none")).toBe(true);
      });
