import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import {
  chartRoot,
  workbook,
  chartWorkbookBindingDeck,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  getAttrValue,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const modern = "http://schemas.microsoft.com/office/drawing/2007/8/2/chart";
const kinds = ["bar", "column", "line", "area", "pie", "doughnut"];
const xml = (p, shape) =>
  parseXml(
    new TextDecoder().decode(
      P._internalPackageOf(p).getPart(chartRoot(shape)).data,
    ),
  );
const options = (spec) => ({
  x: P.inches(1),
  y: P.inches(1),
  w: P.inches(4),
  h: P.inches(3),
  spec,
});
const identity = (spec) => [spec.chartStyle, spec.chartStyleVariant];
const snapshot = (p) => ({
  parts: P._internalPackageOf(p).parts.map((x) => [
    x.name,
    x.contentType,
    x.data.slice(),
  ]),
  types: structuredClone(P._internalPackageOf(p).contentTypes),
});
const canonical = (e) => [
  e.name.namespaceURI,
  e.name.localName,
  e.attrs.map((a) => [a.name.namespaceURI, a.name.localName, a.value]),
  e.children.map((c) =>
    c.kind === "element" ? canonical(c) : [c.kind, c.data],
  ),
];
function native(f, payload) {
  const d = xml(f.p, f.shape),
    source = parseXml(
      `<c:chartSpace xmlns:c="${NS.chart}" xmlns:mc="${NS.mc}" xmlns:mod="${modern}" xmlns:future="urn:owned:future">${payload}</c:chartSpace>`,
    ).root;
  for (const [prefix, uri] of source.prefixDecls)
    d.root.prefixDecls.set(prefix, uri);
  d.root.children.unshift(...source.children);
  P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data =
    new TextEncoder().encode(serializeXml(d));
}
function fixture(payload, kind = "bar") {
  const f = chartWorkbookBindingDeck(kind),
    chart = P.getSlideCharts(f.slide)[0];
  f.shape = chart.shape;
  native(f, payload);
  return f;
}
const alternate = (style, choices = "") =>
  `<mc:AlternateContent future:mode="future:local">${choices}<mc:Choice Requires="mod"><mod:style val="${style + 100}"/></mc:Choice><mc:Fallback><c:style val="${style}"/></mc:Fallback></mc:AlternateContent>`;
const slot = (p, shape) =>
  xml(p, shape).root.children.find(
    (e) =>
      e.kind === "element" &&
      ((e.name.namespaceURI === NS.mc &&
        e.name.localName === "AlternateContent") ||
        (e.name.namespaceURI === NS.chart && e.name.localName === "style")),
  );
function assertStyle(p, shape, id, variant) {
  expect(identity(P.getShapeChartSpec(shape))).toEqual([id, variant]);
  const root = xml(p, shape).root,
    values = [];
  walkElements(root, (e) => {
    if (
      e.name.localName === "style" &&
      [NS.chart, modern].includes(e.name.namespaceURI)
    )
      values.push([e.name.namespaceURI, getAttrValue(e, qname("", "val", ""))]);
  });
  expect(values).toEqual(
    variant
      ? [
          [modern, String(id + 100)],
          [NS.chart, String(id)],
        ]
      : [[NS.chart, String(id)]],
  );
  const children = root.children.filter((e) => e.kind === "element");
  const styleIndex = children.findIndex(
      (e) =>
        e.name.localName === "style" ||
        (e.name.namespaceURI === NS.mc &&
          e.name.localName === "AlternateContent"),
    ),
    chartIndex = children.findIndex(
      (e) => e.name.namespaceURI === NS.chart && e.name.localName === "chart",
    );
  expect(styleIndex).toBeLessThan(chartIndex);
  expect(P.validatePresentation(p)).toEqual([]);
}
describe("native chart style identity and compatibility markup", () => {
  for (const kind of kinds)
    for (const style of [1, 13, 48])
      for (const variant of [undefined, "office2010"])
        it(`${kind} authors and edits style ${style}, variant ${variant ?? "legacy"}, with valid fallback and export`, async () => {
          const p = createDeck("blank"),
            slide = P.getSlides(p)[0],
            shape = P.addSlideChart(
              slide,
              options({
                kind,
                categories: ["One", "Two"],
                series: [{ name: "Units", values: [4, 9] }],
                chartStyle: style,
                ...(variant ? { chartStyleVariant: variant } : {}),
              }),
            );
          assertStyle(p, shape, style, variant);
          const next = style === 48 ? 7 : style + 1,
            chart = P.getSlideCharts(slide)[0];
          P.setChartSpec(chart, {
            ...chart.spec,
            chartStyle: next,
            series: [{ ...chart.spec.series[0], values: [3, 8] }],
          });
          assertStyle(p, shape, next, variant);
          const q = await P.loadPresentation(await P.savePresentation(p));
          assertStyle(
            q,
            P.getSlideCharts(P.getSlides(q)[0])[0].shape,
            next,
            variant,
          );
        });
  it.each([
    [
      "legacy supported Choice",
      '<mc:AlternateContent><mc:Choice Requires="c"><c:style val="31"/></mc:Choice><mc:Fallback><c:style val="7"/></mc:Fallback></mc:AlternateContent>',
      31,
      undefined,
    ],
    [
      "unknown first Choice",
      alternate(
        11,
        '<mc:Choice Requires="future"><future:style val="900"/></mc:Choice>',
      ),
      11,
      "office2010",
    ],
    [
      "unknown requirement on a modern Choice",
      '<mc:AlternateContent><mc:Choice Requires="mod future"><mod:style val="131"/></mc:Choice><mc:Fallback><c:style val="17"/></mc:Fallback></mc:AlternateContent>',
      17,
      undefined,
    ],
    [
      "namespace-shadowed requirement",
      '<mc:AlternateContent><mc:Choice Requires="mod" xmlns:mod="urn:other"><mod:style val="133"/></mc:Choice><mc:Fallback><c:style val="12"/></mc:Fallback></mc:AlternateContent>',
      12,
      undefined,
    ],
    [
      "unbound requirement",
      '<mc:AlternateContent><mc:Choice Requires="missing"><mod:style val="133"/></mc:Choice><mc:Fallback><c:style val="12"/></mc:Fallback></mc:AlternateContent>',
      12,
      undefined,
    ],
    [
      "missing requirement",
      '<mc:AlternateContent><mc:Choice><mod:style val="133"/></mc:Choice><mc:Fallback><c:style val="12"/></mc:Fallback></mc:AlternateContent>',
      12,
      undefined,
    ],
    [
      "unsupported c14 feature",
      '<mc:AlternateContent><mc:Choice Requires="mod"><mod:pivotOptions/><mod:style val="133"/></mc:Choice><mc:Fallback><c:style val="12"/></mc:Fallback></mc:AlternateContent>',
      12,
      undefined,
    ],
    [
      "nested compatibility",
      '<mc:AlternateContent><mc:Choice Requires="mod"><mc:AlternateContent><mc:Choice Requires="mod"><mod:style val="140"/></mc:Choice><mc:Fallback><c:style val="40"/></mc:Fallback></mc:AlternateContent></mc:Choice><mc:Fallback><c:style val="40"/></mc:Fallback></mc:AlternateContent>',
      40,
      "office2010",
    ],
    [
      "qualified modern style with lexical normalization",
      '<mc:AlternateContent><mc:Choice Requires="mod"><mod:style val=" +00148 "/></mc:Choice><mc:Fallback><c:style val="48"/></mc:Fallback></mc:AlternateContent>',
      48,
      "office2010",
    ],
    [
      "foreign wrapper",
      '<future:AlternateContent><future:Choice><c:style val="8"/></future:Choice></future:AlternateContent>',
      undefined,
      undefined,
    ],
  ])(
    "selects %s without flattening the native package",
    (_, payload, style, variant) => {
      const f = fixture(payload),
        before = snapshot(f.p);
      expect(identity(P.getShapeChartSpec(f.shape))).toEqual([style, variant]);
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it.each(["2tail", "2.5", "0x10", "0", "49", "NaN", "Infinity", "-1", ""])(
    "does not interpret malformed legacy style %s as a valid preset",
    (value) => {
      const f = fixture(`<c:style val="${value}"/>`);
      expect(identity(P.getShapeChartSpec(f.shape))).toEqual([
        undefined,
        undefined,
      ]);
    },
  );
  it("retains native aliases, opaque choices/attributes and declaration scope through data-only edits", async () => {
    const f = fixture(
        alternate(
          32,
          '<mc:Choice Requires="future"><future:style future:source="future:local" val="903"/></mc:Choice>',
        ),
      ),
      before = canonical(slot(f.p, f.shape)),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [{ ...chart.spec.series[0], values: [2, 7, 10] }],
    });
    expect(canonical(slot(f.p, f.shape))).toEqual(before);
    const d = xml(f.p, f.shape),
      nativeSlot = slot(f.p, f.shape);
    expect(nativeSlot.prefixDecls.get("future")).toBe("urn:owned:future");
    expect(nativeSlot.prefixDecls.get("mod")).toBe(modern);
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([2, 7, 10]);
    const q = await P.loadPresentation(await P.savePresentation(f.p));
    expect(
      canonical(slot(q, P.getSlideCharts(P.getSlides(q)[0])[0].shape)),
    ).toEqual(before);
  });
  it.each([
    '<mod:pivotOptions><mod:dropZoneFilter val="1"/></mod:pivotOptions>',
    '<future:settings future:mode="future:local"/>',
  ])(
    "preserves unrepresented options when a style choice needs the legacy read fallback: %s",
    (payload) => {
      const f = fixture(
          `<mc:AlternateContent><mc:Choice Requires="mod"><mod:style val="121"/>${payload}</mc:Choice><mc:Fallback><c:style val="21"/></mc:Fallback></mc:AlternateContent>`,
        ),
        chart = P.getSlideCharts(f.slide)[0],
        before = canonical(slot(f.p, f.shape));
      expect(identity(chart.spec)).toEqual([21, undefined]);
      P.setChartSpec(chart, {
        ...chart.spec,
        series: [{ ...chart.spec.series[0], values: [7, 11, 13] }],
      });
      expect(canonical(slot(f.p, f.shape))).toEqual(before);
      expect(identity(P.getShapeChartSpec(f.shape))).toEqual([21, undefined]);
    },
  );
  it("preserves an inactive fallback preset when the selected supported Choice is empty", () => {
    const f = fixture(
        '<mc:AlternateContent><mc:Choice Requires="c"/><mc:Fallback><c:style val="21"/></mc:Fallback></mc:AlternateContent>',
      ),
      chart = P.getSlideCharts(f.slide)[0],
      before = canonical(slot(f.p, f.shape));
    expect(identity(chart.spec)).toEqual([undefined, undefined]);
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [{ ...chart.spec.series[0], values: [7, 11, 13] }],
    });
    expect(canonical(slot(f.p, f.shape))).toEqual(before);
    expect(identity(P.getShapeChartSpec(f.shape))).toEqual([
      undefined,
      undefined,
    ]);
  });
  it("changing variant or clearing a style replaces its native slot without stale alternative presets", () => {
    const f = fixture(alternate(21)),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, { ...chart.spec, chartStyleVariant: undefined });
    assertStyle(f.p, f.shape, 21, undefined);
    const next = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(next, {
      ...next.spec,
      chartStyle: undefined,
      chartStyleVariant: undefined,
    });
    expect(slot(f.p, f.shape)).toBeUndefined();
    expect(identity(P.getShapeChartSpec(f.shape))).toEqual([
      undefined,
      undefined,
    ]);
  });
  it("does not replay other known settings from a compound compatibility block alongside newly authored metadata", () => {
    const f = fixture(
        '<mc:AlternateContent><mc:Choice Requires="mod"><mod:style val="117"/></mc:Choice><mc:Fallback><c:style val="17"/><c:lang val="en-US"/></mc:Fallback></mc:AlternateContent>',
      ),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, { ...chart.spec, language: "fr-FR" });
    assertStyle(f.p, f.shape, 17, "office2010");
    const root = xml(f.p, f.shape).root,
      langs = [];
    walkElements(root, (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "lang")
        langs.push(getAttrValue(e, qname("", "val", "")));
    });
    expect(langs).toEqual(["fr-FR"]);
  });
  it.each([0, 49, -1, 1.5, NaN, Infinity, -Infinity, "2", null, true])(
    "rejects invalid style %j atomically on add and edit",
    (value) => {
      const f = fixture(alternate(8)),
        chart = P.getSlideCharts(f.slide)[0],
        before = snapshot(f.p),
        spec = { ...chart.spec, chartStyle: value };
      expect(() => P.setChartSpec(chart, spec)).toThrow(
        "chartStyle: expected an integer",
      );
      expect(snapshot(f.p)).toEqual(before);
      expect(() => P.addSlideChart(f.slide, options(spec))).toThrow(
        "chartStyle: expected an integer",
      );
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it.each(["legacy", "future", 0, null])(
    "rejects invalid style variant %j atomically",
    (value) => {
      const f = fixture(alternate(8)),
        chart = P.getSlideCharts(f.slide)[0],
        before = snapshot(f.p),
        spec = { ...chart.spec, chartStyleVariant: value };
      expect(() => P.setChartSpec(chart, spec)).toThrow("chartStyleVariant");
      expect(snapshot(f.p)).toEqual(before);
      expect(() => P.addSlideChart(f.slide, options(spec))).toThrow(
        "chartStyleVariant",
      );
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it("rejects an office2010 chartStyleVariant without a base style before allocating or rewriting parts", () => {
    const f = fixture(alternate(8)),
      chart = P.getSlideCharts(f.slide)[0],
      before = snapshot(f.p),
      spec = { ...chart.spec, chartStyle: undefined };
    expect(() => P.setChartSpec(chart, spec)).toThrow(
      "chartStyleVariant requires chartStyle",
    );
    expect(snapshot(f.p)).toEqual(before);
    expect(() => P.addSlideChart(f.slide, options(spec))).toThrow(
      "chartStyleVariant requires chartStyle",
    );
    expect(snapshot(f.p)).toEqual(before);
  });
  it.each(kinds)(
    "keeps native %s style through transfer both ways and independent copied edits",
    async (kind) => {
      const f = fixture(alternate(29), kind),
        before = canonical(slot(f.p, f.shape)),
        originalBook = workbook(f.p, f.shape).data.slice(),
        target = createDeck("blank"),
        slide = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
          preservePaintFormatting: true,
        });
      const q = await P.loadPresentation(await P.savePresentation(target)),
        imported = P.getSlides(q).at(-1),
        copied = P.getSlideCharts(imported)[0];
      expect(identity(copied.spec)).toEqual([29, "office2010"]);
      expect(canonical(slot(q, copied.shape))).toEqual(before);
      const back = P.importSlide(f.p, imported, P.getSlideLayout(f.slide), {
          preservePaintFormatting: true,
        }),
        returned = P.getSlideCharts(back)[0];
      expect(canonical(slot(f.p, returned.shape))).toEqual(before);
      P.setChartSpec(returned, {
        ...returned.spec,
        chartStyle: 35,
        series: [{ ...returned.spec.series[0], values: [8, 9, 10] }],
      });
      assertStyle(f.p, returned.shape, 35, "office2010");
      expect(canonical(slot(f.p, f.shape))).toEqual(before);
      expect(workbook(f.p, f.shape).data).toEqual(originalBook);
      expect(workbook(f.p, returned.shape).name).not.toBe(
        workbook(f.p, f.shape).name,
      );
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
});
