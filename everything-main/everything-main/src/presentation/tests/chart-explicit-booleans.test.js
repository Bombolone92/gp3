import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartExplicitBooleanDeck as fixture,
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

const child = (e, n) => firstChildElement(e, qname("c", n, NS.chart));
const options = [
  ["roundedCorners", "roundedCorners", (r) => r],
  [
    "categoryAxisNoMultiLevelLabel",
    "noMultiLvlLbl",
    (r) => child(child(child(r, "chart"), "plotArea"), "catAx"),
  ],
  [
    "invertIfNegative",
    "invertIfNegative",
    (r) =>
      child(child(child(child(r, "chart"), "plotArea"), "barChart"), "ser"),
  ],
];
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
const specValue = (spec, key) =>
  key === "invertIfNegative" ? spec.series[0][key] : spec[key];
const parts = (p) =>
  P._internalPackageOf(p).parts.map((part) => [
    part.name,
    part.contentType,
    part.data.slice(),
  ]);
const xmlValue = (f, name, host) => {
  const node = child(host(document(f).root), name);
  return node ? getAttrValue(node, qname("", "val", "")) : undefined;
};

describe("explicit native chart boolean settings", () => {
  for (const [key, name, host] of options)
    for (const [token, expected] of [
      ["0", false],
      ["false", false],
      ["1", true],
      ["true", true],
      [null, true],
      [" \tfalse\r\n", false],
      [" true ", true],
      ["", undefined],
      ["2", undefined],
      ["FALSE", undefined],
      ["\u00a0true\u00a0", undefined],
    ])
      it(`${key} reads ${JSON.stringify(token)} with CT_Boolean lexical semantics`, () => {
        const f = fixture(),
          doc = document(f),
          parent = host(doc.root);
        // Seed native XML independently of the authoring behavior under test.
        parent.children = parent.children.filter(
          (e) => e !== child(parent, name),
        );
        parent.children.push({
          kind: "element",
          name: qname("c", name, NS.chart),
          attrs:
            token === null
              ? []
              : [{ name: qname("", "val", ""), value: token }],
          children: [],
          prefixDecls: new Map(),
        });
        write(f, doc);
        const before = parts(f.p);
        expect(specValue(P.getShapeChartSpec(f.shape), key)).toBe(expected);
        expect(parts(f.p)).toEqual(before);
      });
  for (const [key, name, host] of options)
    it(`${key} retains omission and allows explicit clearing`, () => {
      const f = fixture(),
        doc = document(f),
        parent = host(doc.root);
      parent.children = parent.children.filter(
        (e) => e !== child(parent, name),
      );
      write(f, doc);
      let chart = P.getSlideCharts(f.slide)[0];
      expect(specValue(chart.spec, key)).toBeUndefined();
      P.setChartSpec(chart, { ...chart.spec, title: "Edited" });
      expect(xmlValue(f, name, host)).toBeUndefined();
      chart = P.getSlideCharts(f.slide)[0];
      const spec =
        key === "invertIfNegative"
          ? {
              ...chart.spec,
              series: [{ ...chart.spec.series[0], [key]: false }],
            }
          : { ...chart.spec, [key]: false };
      P.setChartSpec(chart, spec);
      expect(xmlValue(f, name, host)).toBe("0");
      P.setChartSpec(
        P.getSlideCharts(f.slide)[0],
        key === "invertIfNegative"
          ? { ...spec, series: [{ ...spec.series[0], [key]: undefined }] }
          : { ...spec, [key]: undefined },
      );
      expect(xmlValue(f, name, host)).toBeUndefined();
    });
  for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
    for (const value of [false, true])
      it(`${kind} authors ${value} only on schema-valid hosts and retains it after edits/export`, async () => {
        const f = fixture(kind, value),
          chart = P.getSlideCharts(f.slide)[0];
        expect(chart.spec.roundedCorners).toBe(value);
        expect(chart.spec.categoryAxisNoMultiLevelLabel).toBe(
          ["pie", "doughnut"].includes(kind) ? undefined : value,
        );
        expect(chart.spec.series[0].invertIfNegative).toBe(
          ["bar", "column"].includes(kind) ? value : undefined,
        );
        P.setChartSpec(chart, {
          ...chart.spec,
          series: [
            { ...chart.spec.series[0], name: "Changed", values: [-8, 12] },
          ],
        });
        const reopened = await P.loadPresentation(
            await P.savePresentation(f.p),
          ),
          spec = P.getSlideCharts(P.getSlides(reopened)[0])[0].spec;
        expect(spec.roundedCorners).toBe(value);
        expect(spec.categoryAxisNoMultiLevelLabel).toBe(
          chart.spec.categoryAxisNoMultiLevelLabel,
        );
        expect(spec.series[0].invertIfNegative).toBe(
          chart.spec.series[0].invertIfNegative,
        );
        expect(spec.series[0].values).toEqual([-8, 12]);
        expect(P.validatePresentation(reopened)).toEqual([]);
      });
  it("keeps false options independent through whole-slide transfer both ways and returned-copy edits", async () => {
    const f = fixture(),
      originalBook = workbook(f.p, f.shape).data.slice(),
      originalSvg = preview(f.p, f.slide),
      target = createDeck("blank"),
      forward = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
        preservePaintFormatting: true,
      }),
      back = P.importSlide(f.p, forward, P.getSlideLayout(f.slide), {
        preservePaintFormatting: true,
      });
    for (const [p, slide] of [
      [target, forward],
      [f.p, back],
    ]) {
      const chart = P.getSlideCharts(slide)[0];
      for (const [key] of options)
        expect(specValue(chart.spec, key)).toBe(false);
      P.setChartSpec(chart, {
        ...chart.spec,
        roundedCorners: true,
        categoryAxisNoMultiLevelLabel: true,
        series: [{ ...chart.spec.series[0], invertIfNegative: true }],
      });
      const reopened = await P.loadPresentation(await P.savePresentation(p)),
        spec = P.getSlideCharts(P.getSlides(reopened).at(-1))[0].spec;
      for (const [key] of options) expect(specValue(spec, key)).toBe(true);
    }
    for (const [key] of options)
      expect(specValue(P.getShapeChartSpec(f.shape), key)).toBe(false);
    expect(workbook(f.p, f.shape).data).toEqual(originalBook);
    expect(preview(f.p, f.slide)).toBe(originalSvg);
  });
  it("false inversion retains the authored color for negative bars", () => {
    const f = fixture(),
      fills = [];
    walkElements(
      parseXml(
        decodeURIComponent(preview(f.p, f.slide).split(",").slice(1).join(",")),
      ).root,
      (e) => {
        if (
          e.name.localName === "rect" &&
          getAttrValue(e, qname("", "fill", "")) === "#276491"
        )
          fills.push(e);
      },
    );
    expect(fills).toHaveLength(2);
  });
  for (const [key] of options)
    for (const value of [null, 0, "false", {}])
      it(`${key} rejects ${JSON.stringify(value)} atomically`, () => {
        const f = fixture(),
          chart = P.getSlideCharts(f.slide)[0],
          before = parts(f.p),
          spec =
            key === "invertIfNegative"
              ? {
                  ...chart.spec,
                  series: [{ ...chart.spec.series[0], [key]: value }],
                }
              : { ...chart.spec, [key]: value };
        expect(() => P.setChartSpec(chart, spec)).toThrow(/boolean/);
        expect(parts(f.p)).toEqual(before);
      });
});
