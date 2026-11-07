import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartMaximumLabelsDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  getAttrValue,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const child = (e, name) => firstChildElement(e, qname("c", name, NS.chart));
const attr = (e, name) => e && getAttrValue(e, qname("", name, ""));
const document = (f) =>
  parseXml(
    new TextDecoder().decode(
      P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
    ),
  );
const write = (f, doc) => {
  P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data =
    new TextEncoder().encode(serializeXml(doc));
};
const edit = (f, changes) => {
  const chart = P.getSlideCharts(f.slide)[0];
  P.setChartSpec(chart, { ...chart.spec, ...changes });
};
const labels = (f) => {
  const out = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(f.p, f.slide).split(",").slice(1).join(",")),
    ).root,
    (e) => {
      if (e.name.localName === "text" && attr(e, "fill") === "#123ABC")
        out.push(
          e.children
            .filter((n) => n.kind === "text")
            .map((n) => n.data)
            .join(""),
        );
    },
  );
  return out;
};
const option = (f) =>
  child(child(document(f).root, "chart"), "showDLblsOverMax");
const geometry = (f) => {
  const out = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(f.p, f.slide).split(",").slice(1).join(",")),
    ).root,
    (e) => {
      if (e.name.localName !== "text")
        out.push([e.name.namespaceURI, e.name.localName, e.attrs]);
    },
  );
  return out;
};
const parts = (p) =>
  P._internalPackageOf(p).parts.map((part) => [
    part.name,
    part.contentType,
    part.data.slice(),
  ]);

describe("native data labels over the value-axis maximum", () => {
  for (const [value, expected] of [
    ["0", false],
    ["false", false],
    ["1", true],
    ["true", true],
    [null, true],
    [" true ", true],
    ["\u00a0true\u00a0", undefined],
    ["", undefined],
    ["2", undefined],
    ["yes", undefined],
  ])
    it(`reads the native CT_Boolean value ${JSON.stringify(value)} without guessing invalid tokens`, () => {
      const f = chartMaximumLabelsDeck(),
        doc = document(f),
        node = child(child(doc.root, "chart"), "showDLblsOverMax");
      node.attrs =
        value === null ? [] : [{ name: qname("", "val", ""), value }];
      write(f, doc);
      expect(P.getShapeChartSpec(f.shape).showDataLabelsOverMaximum).toBe(
        expected,
      );
    });
  it("keeps omission distinct from an explicit option", () => {
    const f = chartMaximumLabelsDeck(),
      doc = document(f),
      chart = child(doc.root, "chart");
    chart.children = chart.children.filter(
      (node) => node !== child(chart, "showDLblsOverMax"),
    );
    write(f, doc);
    expect(
      P.getShapeChartSpec(f.shape).showDataLabelsOverMaximum,
    ).toBeUndefined();
    edit(f, {});
    expect(option(f)).toBeNull();
  });
  for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
    for (const value of [false, true])
      it(`${kind} retains ${value} through data edits, export/reopen and independent transfer both ways`, async () => {
        const f = chartMaximumLabelsDeck(kind);
        edit(f, { showDataLabelsOverMaximum: value });
        expect(attr(option(f), "val")).toBe(value ? "1" : "0");
        expect(P.getShapeChartSpec(f.shape).showDataLabelsOverMaximum).toBe(
          value,
        );
        const chart = P.getSlideCharts(f.slide)[0];
        edit(f, {
          series: chart.spec.series.map((s) => ({
            ...s,
            name: "Changed",
            values: [3, 7, 12],
          })),
        });
        expect(attr(option(f), "val")).toBe(value ? "1" : "0");
        const originalBook = workbook(f.p, f.shape).data.slice(),
          target = createDeck("blank"),
          forward = P.importSlide(
            target,
            f.slide,
            P.getSlideLayouts(target)[0],
            { preservePaintFormatting: true },
          ),
          back = P.importSlide(f.p, forward, P.getSlideLayout(f.slide), {
            preservePaintFormatting: true,
          });
        for (const [p, slide] of [
          [target, forward],
          [f.p, back],
        ]) {
          const copied = P.getSlideCharts(slide)[0];
          expect(copied.spec.showDataLabelsOverMaximum).toBe(value);
          P.setChartSpec(copied, {
            ...copied.spec,
            showDataLabelsOverMaximum: !value,
          });
          expect(
            P.getShapeChartSpec(copied.shape).showDataLabelsOverMaximum,
          ).toBe(!value);
          const reopened = await P.loadPresentation(
            await P.savePresentation(p),
          );
          expect(
            P.getSlideCharts(P.getSlides(reopened).at(-1))[0].spec
              .showDataLabelsOverMaximum,
          ).toBe(!value);
          expect(P.validatePresentation(reopened)).toEqual([]);
        }
        expect(P.getShapeChartSpec(f.shape).showDataLabelsOverMaximum).toBe(
          value,
        );
        expect(workbook(f.p, f.shape).data).toEqual(originalBook);
        const children = child(document(f).root, "chart")
          .children.filter((n) => n.kind === "element")
          .map((n) => n.name.localName);
        expect(children.indexOf("showDLblsOverMax")).toBeGreaterThan(
          children.indexOf("dispBlanksAs"),
        );
        expect(children.indexOf("showDLblsOverMax")).toBeLessThan(
          children.indexOf("extLst"),
        );
        edit(f, { showDataLabelsOverMaximum: undefined });
        expect(option(f)).toBeNull();
      });
  for (const kind of ["bar", "column", "line", "area"])
    for (const direction of ["minMax", "maxMin"])
      it(`${kind} ${direction} suppresses only plotted values strictly above the maximum`, () => {
        const f = chartMaximumLabelsDeck(kind),
          chart = P.getSlideCharts(f.slide)[0];
        edit(f, {
          valueAxisOrientation: direction,
          categories: ["Below", "At", "Above", "Zero", "Negative", "Gap"],
          series: [
            { ...chart.spec.series[0], values: [2, 7, 11, 0, -3, null] },
          ],
          showDataLabelsOverMaximum: false,
        });
        expect(labels(f)).toEqual(["2", "7", "0", "-3"]);
        const beforeGeometry = geometry(f);
        edit(f, { showDataLabelsOverMaximum: true });
        expect(labels(f)).toEqual(["2", "7", "11", "0", "-3"]);
        expect(geometry(f)).toEqual(beforeGeometry);
        edit(f, { showDataLabelsOverMaximum: undefined });
        expect(labels(f)).toEqual(["2", "7", "11", "0", "-3"]);
      });
  for (const kind of ["bar", "column", "line", "area"])
    it(`${kind} stacked labels use cumulative plotted values, while negative values below the minimum remain unaffected`, () => {
      const f = chartMaximumLabelsDeck(kind),
        series = P.getShapeChartSpec(f.shape).series[0];
      edit(f, {
        grouping: "stacked",
        showDataLabelsOverMaximum: false,
        categories: ["Positive", "Negative"],
        valueAxis: { min: -6, max: 6 },
        series: [
          { ...series, values: [3, -4] },
          { ...series, name: "Other", values: [5, -4] },
        ],
      });
      expect(labels(f).sort()).toEqual(["3", "-4", "-4"].sort());
      edit(f, { showDataLabelsOverMaximum: true });
      expect(labels(f).sort()).toEqual(["3", "5", "-4", "-4"].sort());
    });
  for (const kind of ["bar", "column", "line", "area"])
    it(`${kind} percentage stacking compares normalized plotted values instead of raw input`, () => {
      const f = chartMaximumLabelsDeck(kind),
        series = P.getShapeChartSpec(f.shape).series[0];
      edit(f, {
        grouping: "percentStacked",
        showDataLabelsOverMaximum: false,
        categories: ["One", "Two"],
        series: [
          { ...series, values: [20, 30] },
          { ...series, name: "Other", values: [40, 60] },
        ],
      });
      expect(labels(f)).toHaveLength(4);
    });
  it("combo labels use their own primary/secondary scale and per-series label toggles", () => {
    const f = chartMaximumLabelsDeck("column", true);
    expect(labels(f)).toEqual(["2", "7", "40", "50", "60"]);
    edit(f, { showDataLabelsOverMaximum: true });
    expect(labels(f)).toEqual(["2", "7", "11", "40", "50", "60"]);
    const chart = P.getSlideCharts(f.slide)[0];
    edit(f, {
      showDataLabelsOverMaximum: false,
      series: chart.spec.series.map((s, i) => ({
        ...s,
        dataLabels: { ...s.dataLabels, showValue: i !== 1 },
      })),
    });
    expect(labels(f)).toEqual(["2", "7"]);
  });
  it("rejects non-boolean options before changing chart or workbook parts", () => {
    const f = chartMaximumLabelsDeck(),
      before = parts(f.p);
    for (const value of [0, 1, "false", null, {}]) {
      expect(() => edit(f, { showDataLabelsOverMaximum: value })).toThrow(
        /boolean/,
      );
      expect(parts(f.p)).toEqual(before);
    }
  });
});
