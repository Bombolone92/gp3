import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, chartAxisReferenceDeck } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, name) => firstChildElement(e, qname("", name, NS.chart));
function fixture(kind = "column") {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.inches(1),
      y: P.inches(0.6),
      w: P.inches(8),
      h: P.inches(5),
      spec: {
        kind,
        categories: ["North", "South", "West"],
        series: [
          { name: "Primary", values: [4, 9, -2], color: "#376AB2" },
          {
            name: "Secondary",
            values: [40, 90, 20],
            secondaryAxis: true,
            chartKind: kind === "column" ? "line" : kind,
          },
        ],
        valueAxis: {
          min: -5,
          max: 25,
          majorUnit: 5,
          minorUnit: 1,
          numberFormat: "0.0",
          displayUnits: "thousands",
        },
        valueAxisTitle: "Primary units",
        valueAxisTitleStyle: { bold: true },
        valueAxisLabelStyle: { color: "#A2307B", sizePt: 13 },
        valueAxisHidden: false,
        valueAxisOrientation: "maxMin",
        valueAxisCrosses: { at: 3 },
        valueAxisCrossBetween: "midCat",
        valueAxisMajorTickMark: "cross",
        valueAxisMinorTickMark: "in",
        valueAxisMajorGridlines: true,
        valueAxisMinorGridlines: true,
        valueAxisLineColor: null,
        valueAxisMajorGridlineColor: "#8263BF",
        valueAxisMinorGridlineColor: null,
        valueAxisLabelRotationDeg: 17,
        categoryAxisLabelRotationDeg: 0,
      },
    });
  return {
    p,
    slide,
    shape,
    part: P._internalPackageOf(p).getPart(chartRoot(shape)),
  };
}
function edit(f, fn) {
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    plot = child(child(doc.root, "chart"), "plotArea");
  fn(plot);
  f.part.data = new TextEncoder().encode(serializeXml(doc));
}
function reorder(plot, unused = false) {
  const axes = allChildElements(plot, qname("", "valAx", NS.chart));
  plot.children = plot.children.filter((e) => !axes.includes(e));
  if (unused) {
    const extra = structuredClone(axes[1]);
    child(extra, "axId").attrs[0].value = "987654321";
    plot.children.push(extra);
  }
  plot.children.push(axes[1], axes[0]);
}
const axisMetadata = (s) =>
  Object.fromEntries(
    Object.entries(s).filter(
      ([k]) => k.startsWith("valueAxis") || k.startsWith("categoryAxis"),
    ),
  );
describe("native plot-group value-axis references", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const unused of [false, true])
      it(`${kind} keeps primary metadata and preview with ${unused ? "unreferenced and " : ""}secondary value axes first`, () => {
        const f = fixture(kind),
          spec = P.getShapeChartSpec(f.shape),
          before = preview(f.p, f.slide);
        edit(f, (plot) => reorder(plot, unused));
        const native = f.part.data.slice();
        expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
        expect(preview(f.p, f.slide)).toBe(before);
        expect(f.part.data).toEqual(native);
      });
  it.each(["column", "line"])(
    "%s resolves primary axes even when the secondary plot group is first",
    (kind) => {
      const f = fixture(kind),
        spec = P.getShapeChartSpec(f.shape);
      edit(f, (plot) => {
        reorder(plot);
        const groups = plot.children.filter(
          (e) =>
            e.kind === "element" &&
            e.name.namespaceURI === NS.chart &&
            ["barChart", "lineChart", "areaChart"].includes(e.name.localName),
        );
        plot.children = plot.children.filter((e) => !groups.includes(e));
        plot.children.unshift(...groups.reverse());
      });
      expect(axisMetadata(P.getShapeChartSpec(f.shape))).toEqual(
        axisMetadata(spec),
      );
    },
  );
  it("uses referenced arbitrary axis IDs rather than builder-specific constants", () => {
    const f = fixture(),
      spec = P.getShapeChartSpec(f.shape);
    edit(f, (plot) => {
      const ids = new Map();
      walkElements(plot, (e) => {
        if (
          e.name.namespaceURI !== NS.chart ||
          !["axId", "crossAx"].includes(e.name.localName)
        )
          return;
        const a = e.attrs.find((a) => a.name.localName === "val");
        if (!ids.has(a.value)) ids.set(a.value, String(713000 + ids.size * 19));
        a.value = ids.get(a.value);
      });
      reorder(plot);
    });
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
  });
  it.each(["zeros", "plus", "spaces"])(
    "matches %s lexical spellings of the same unsigned axis identifier",
    (spelling) => {
      const f = fixture(),
        spec = P.getShapeChartSpec(f.shape);
      edit(f, (plot) => {
        for (const axis of plot.children) {
          if (
            axis.kind !== "element" ||
            axis.name.namespaceURI !== NS.chart ||
            !["catAx", "valAx"].includes(axis.name.localName)
          )
            continue;
          const id = child(axis, "axId").attrs[0];
          id.value =
            spelling === "zeros"
              ? `00${id.value}`
              : spelling === "plus"
                ? `+${id.value}`
                : ` ${id.value} `;
        }
        reorder(plot);
      });
      const before = f.part.data.slice();
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
      expect(f.part.data).toEqual(before);
    },
  );
  it.each(["column", "line"])(
    "%s keeps a right-side primary axis when an unused value axis precedes it",
    (kind) => {
      const f = fixture(kind),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, { ...chart.spec, series: [chart.spec.series[0]] });
      edit(f, (plot) => {
        child(child(plot, "valAx"), "axPos").attrs[0].value = "r";
      });
      const spec = P.getShapeChartSpec(f.shape);
      edit(f, (plot) => {
        const extra = structuredClone(child(plot, "valAx"));
        child(extra, "axId").attrs[0].value = "987654321";
        child(extra, "axPos").attrs[0].value = "l";
        child(extra, "crossAx").attrs[0].value = "987654322";
        child(child(extra, "scaling"), "max").attrs[0].value = "900";
        plot.children.unshift(extra);
      });
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    },
  );
  it("does not invent a secondary axis for multiple groups sharing one right-side value axis", () => {
    const f = fixture(),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, { ...chart.spec, series: [chart.spec.series[0]] });
    edit(f, (plot) => {
      child(child(plot, "valAx"), "axPos").attrs[0].value = "r";
      const group = structuredClone(child(plot, "barChart"));
      child(child(group, "ser"), "idx").attrs[0].value = "1";
      child(child(group, "ser"), "order").attrs[0].value = "1";
      plot.children.unshift(group);
    });
    const spec = P.getShapeChartSpec(f.shape);
    edit(f, (plot) => {
      const extra = structuredClone(child(plot, "valAx"));
      child(extra, "axId").attrs[0].value = "987654321";
      child(extra, "axPos").attrs[0].value = "l";
      child(extra, "crossAx").attrs[0].value = "987654322";
      plot.children.unshift(extra);
    });
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    expect(spec.series.every((s) => s.secondaryAxis === undefined)).toBe(true);
  });
  it("keeps both value axes of one native XY coordinate pair primary regardless of their sides", () => {
    const f = fixture(),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, { ...chart.spec, series: [chart.spec.series[0]] });
    edit(f, (plot) => {
      const category = child(plot, "catAx"),
        value = child(plot, "valAx"),
        x = structuredClone(value);
      // XY kinds are import-only. Use owned native ChartML instead of an
      // unsupported authoring API, with two mutually crossing value axes.
      const group = child(plot, "barChart"),
        cache = (values) =>
          `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numLit>`,
        native = parseXml(
          `<c:scatterChart xmlns:c="${NS.chart}"><c:scatterStyle val="marker"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Primary</c:v></c:tx><c:xVal>${cache([1, 2, 3])}</c:xVal><c:yVal>${cache([4, 9, -2])}</c:yVal></c:ser><c:axId val="${child(category, "axId").attrs[0].value}"/><c:axId val="${child(value, "axId").attrs[0].value}"/></c:scatterChart>`,
        ).root;
      plot.children[plot.children.indexOf(group)] = native;
      child(x, "axId").attrs[0].value = child(category, "axId").attrs[0].value;
      child(x, "crossAx").attrs[0].value = child(value, "axId").attrs[0].value;
      child(x, "axPos").attrs[0].value = "b";
      plot.children[plot.children.indexOf(category)] = x;
    });
    const spec = P.getShapeChartSpec(f.shape);
    edit(f, (plot) => {
      allChildElements(plot, qname("", "valAx", NS.chart))[1].children.find(
        (e) => e.kind === "element" && e.name.localName === "axPos",
      ).attrs[0].value = "r";
    });
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    expect(spec.series[0].secondaryAxis).toBeUndefined();
  });
  it.each([false, true])(
    "retains an unused authored primary pair when all series use the secondary pair, secondary-first=%s",
    async (secondaryFirst) => {
      const f = fixture(),
        spec = P.getShapeChartSpec(f.shape);
      edit(f, (plot) => {
        const axes = allChildElements(plot, qname("", "catAx", NS.chart)),
          values = allChildElements(plot, qname("", "valAx", NS.chart)),
          ids = [
            child(axes[1], "axId").attrs[0].value,
            child(values[1], "axId").attrs[0].value,
          ];
        for (const group of plot.children) {
          if (
            group.kind !== "element" ||
            !["barChart", "lineChart"].includes(group.name.localName)
          )
            continue;
          allChildElements(group, qname("", "axId", NS.chart)).forEach(
            (id, i) => {
              id.attrs[0].value = ids[i];
            },
          );
        }
        if (secondaryFirst) reorder(plot);
      });
      const native = f.part.data.slice(),
        actual = P.getShapeChartSpec(f.shape);
      expect(axisMetadata(actual)).toEqual(axisMetadata(spec));
      expect(actual.series.every((s) => s.secondaryAxis === true)).toBe(true);
      expect(f.part.data).toEqual(native);
      const q = createDeck("blank"),
        to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
        back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
      for (const s of [to, back]) {
        const copied = P.getSlideCharts(s)[0].spec;
        expect(axisMetadata(copied)).toEqual(axisMetadata(spec));
        expect(copied.series.every((s) => s.secondaryAxis === true)).toBe(true);
      }
      const reopened = await P.loadPresentation(await P.savePresentation(q)),
        exported = P.getSlideCharts(P.getSlides(reopened).at(-1))[0].spec;
      expect(axisMetadata(exported)).toEqual(axisMetadata(spec));
      expect(exported.series.every((s) => s.secondaryAxis === true)).toBe(true);
      expect(P.validatePresentation(reopened)).toEqual([]);
      expect(f.part.data).toEqual(native);
    },
  );
  it("retains the unused primary value axis when a shared category axis crosses the secondary value axis", () => {
    const f = fixture(),
      spec = P.getShapeChartSpec(f.shape);
    edit(f, (plot) => {
      const cats = allChildElements(plot, qname("", "catAx", NS.chart)),
        values = allChildElements(plot, qname("", "valAx", NS.chart)),
        catId = child(cats[0], "axId").attrs[0].value,
        secondaryId = child(values[1], "axId").attrs[0].value;
      plot.children = plot.children.filter((e) => e !== cats[1]);
      child(cats[0], "crossAx").attrs[0].value = secondaryId;
      child(values[1], "crossAx").attrs[0].value = catId;
      for (const group of plot.children) {
        if (
          group.kind !== "element" ||
          !["barChart", "lineChart"].includes(group.name.localName)
        )
          continue;
        allChildElements(group, qname("", "axId", NS.chart)).forEach(
          (id, i) => {
            id.attrs[0].value = i ? secondaryId : catId;
          },
        );
      }
    });
    const native = f.part.data.slice(),
      actual = P.getShapeChartSpec(f.shape);
    expect(axisMetadata(actual)).toEqual(axisMetadata(spec));
    expect(actual.series.every((s) => s.secondaryAxis === true)).toBe(true);
    expect(f.part.data).toEqual(native);
  });
  it("ignores foreign axis and reference elements without mutating their native payload", () => {
    const f = fixture(),
      spec = P.getShapeChartSpec(f.shape);
    edit(f, (plot) => {
      const foreign = structuredClone(child(plot, "valAx"));
      foreign.name.namespaceURI = "urn:foreign";
      child(child(foreign, "scaling"), "min").attrs[0].value = "-1000";
      const group = child(plot, "barChart"),
        id = structuredClone(child(group, "axId"));
      id.name.namespaceURI = "urn:foreign";
      group.children.unshift(id);
      reorder(plot);
      plot.children.unshift(foreign);
    });
    const before = f.part.data.slice();
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    expect(f.part.data).toEqual(before);
  });
  it("retains the existing first-axis fallback when plot references are absent", () => {
    const f = fixture(),
      spec = P.getShapeChartSpec(f.shape);
    edit(f, (plot) => {
      for (const group of plot.children) {
        if (
          group.kind !== "element" ||
          !["barChart", "lineChart"].includes(group.name.localName)
        )
          continue;
        group.children = group.children.filter(
          (e) =>
            e.kind !== "element" ||
            e.name.namespaceURI !== NS.chart ||
            e.name.localName !== "axId",
        );
      }
    });
    expect(axisMetadata(P.getShapeChartSpec(f.shape))).toEqual(
      axisMetadata(spec),
    );
  });
  it("retains primary association through transfer both ways and export/reopen", async () => {
    const { p, slide } = chartAxisReferenceDeck(),
      original = P.getSlideCharts(slide).map((c) => c.spec);
    for (const s of original)
      expect(s.valueAxis).toEqual({
        min: -5,
        max: 25,
        majorUnit: 5,
        numberFormat: "0.0",
        numberFormatSourceLinked: false,
      });
    const q = createDeck("blank"),
      to = P.importSlide(q, slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(p, to, P.getSlideLayout(slide));
    for (const s of [to, back])
      expect(P.getSlideCharts(s).map((c) => c.spec)).toEqual(original);
    expect(preview(q, to)).toBe(preview(p, slide));
    const r = await P.loadPresentation(await P.savePresentation(q));
    expect(P.getSlideCharts(P.getSlides(r).at(-1)).map((c) => c.spec)).toEqual(
      original,
    );
    expect(P.validatePresentation(r)).toEqual([]);
    const sourceParts = P.getSlideCharts(slide).map((c) =>
      P._internalPackageOf(p).getPart(chartRoot(c.shape)).data.slice(),
    );
    const copied = P.getSlideCharts(back)[0];
    P.setChartSpec(copied, {
      ...copied.spec,
      valueAxis: { ...copied.spec.valueAxis, max: 50 },
    });
    expect(P.getSlideCharts(slide).map((c) => c.spec)).toEqual(original);
    expect(
      P.getSlideCharts(slide).map(
        (c) => P._internalPackageOf(p).getPart(chartRoot(c.shape)).data,
      ),
    ).toEqual(sourceParts);
    const edited = await P.loadPresentation(await P.savePresentation(p));
    expect(
      P.getSlideCharts(P.getSlides(edited).at(-1))[0].spec.valueAxis.max,
    ).toBe(50);
    expect(P.validatePresentation(edited)).toEqual([]);
  });
});
