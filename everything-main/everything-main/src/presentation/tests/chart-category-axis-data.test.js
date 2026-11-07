import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
import {
  chartStringCache,
  chartNumberCache,
  chartCacheCount,
  chartCachePoints,
  readCacheFormat,
} from "../lib/pptx/src/internal/chartml/chart-cache.ts";
import {
  NS,
  firstChildElement,
  getAttrValue,
  parseXml,
  qname,
  textContent,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  categoryAxisColors,
  categoryAxisDataDeck,
} from "./chart-category-axis-data-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
const measure = (text, font) => ({
  widthPx: ([...text].length * font.sizePx) / 2,
  ascentPx: font.sizePx * 0.75,
  descentPx: font.sizePx * 0.25,
  lineGapPx: 0,
});
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const number = (e, n) => Number(attr(e, n));
function rendered(p, slide) {
  const nodes = [];
  walkElements(
    parseXml(renderSlideToSvg(p, slide, { measureText: measure })).root,
    (e) => nodes.push(e),
  );
  const plot = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#F7F9FB",
  );
  return {
    plot,
    labels: Object.fromEntries(
      Object.entries(categoryAxisColors).map(([role, color]) => [
        role,
        nodes.filter(
          (e) => e.name.localName === "text" && attr(e, "fill") === color,
        ),
      ]),
    ),
    ticks: Object.fromEntries(
      Object.entries(categoryAxisColors).map(([role, color]) => [
        role,
        nodes.filter(
          (e) =>
            e.name.localName === "line" &&
            attr(e, "stroke") === color &&
            Math.hypot(
              number(e, "x2") - number(e, "x1"),
              number(e, "y2") - number(e, "y1"),
            ) < 10,
        ),
      ]),
    ),
  };
}
const texts = (nodes) => nodes.map(textContent).filter(Boolean);
const letters = (prefix, count) =>
  Array.from(
    { length: count },
    (_, i) => `${prefix}-${String.fromCharCode(65 + i)}`,
  );
const sources = (source) => [undefined, undefined, source, undefined];
function categoryCaches(p, shape) {
  const root = parseXml(
    new TextDecoder().decode(
      P._internalPackageOf(p).getPart(chartRoot(shape)).data,
    ),
  ).root;
  const spec = P.getShapeChartSpec(shape);
  return nativeChartSeriesHosts(root)
    .map(({ series }, i) => {
      const cat = firstChildElement(series, qname("", "cat", NS.chart));
      const cache = cat && (chartStringCache(cat) ?? chartNumberCache(cat));
      return {
        name: spec.series[i].name,
        source: cat
          ? cat.children
              .filter(
                (n) => n.kind === "element" && n.name.namespaceURI === NS.chart,
              )
              .map((n) => ({
                kind: n.name.localName,
                formula: ((f) => (f ? textContent(f) : null))(
                  firstChildElement(n, qname("", "f", NS.chart)),
                ),
              }))
          : null,
        cache: cache
          ? {
              type: cache.points.name.localName,
              count: chartCacheCount(cache),
              points: [...chartCachePoints(cache)],
              format: readCacheFormat(cat),
            }
          : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("category data follows native axis references", () => {
  for (const kind of ["column", "bar"]) {
    for (const [primaryCount, secondaryCount] of [
      [4, 6],
      [6, 3],
    ])
      it(`${kind} keeps independent text, value extents and lattices ${primaryCount}/${secondaryCount}`, () => {
        const f = categoryAxisDataDeck({ kind, primaryCount, secondaryCount });
        const raw = f.part.data.slice(),
          before = P.getShapeChartSpec(f.shape);
        const result = rendered(f.p, f.slide);
        for (const [role, count, prefix] of [
          ["primary", primaryCount, "P"],
          ["secondary", secondaryCount, "S"],
        ]) {
          expect(texts(result.labels[role])).toEqual(letters(prefix, count));
          expect(result.ticks[role]).toHaveLength(count + 1);
          result.labels[role].forEach((label, i) => {
            const along =
              kind === "bar"
                ? (number(result.plot, "y") +
                    number(result.plot, "height") -
                    number(label, "y")) /
                  number(result.plot, "height")
                : (number(label, "x") - number(result.plot, "x")) /
                  number(result.plot, "width");
            expect(along).toBeCloseTo((i + 0.5) / count, 3);
          });
        }
        expect(P.getShapeChartSpec(f.shape)).toEqual(before);
        expect(f.part.data).toEqual(raw);
      });
    for (const [name, source, expected] of [
      ["absent", null, letters("T", 4)],
      ["empty", { values: [] }, letters("T", 4)],
      ["blank", { count: 4, points: [] }, []],
      [
        "sparse",
        {
          count: 4,
          points: [
            [1, "S-B"],
            [3, "S-D"],
          ],
        },
        ["S-B", "S-D"],
      ],
      ["partial", { values: ["S-A", "S-B"] }, ["S-A", "S-B"]],
      ["longer than values", { values: letters("S", 6) }, letters("S", 4)],
      [
        "string reference",
        { type: "strRef", values: letters("R", 4) },
        letters("R", 4),
      ],
      [
        "first category level",
        { type: "multiLvlStrRef", values: ["U", "V", "W", "X"] },
        ["U", "V", "W", "X"],
      ],
    ])
      it(`${kind} selects ${name} category caches independently`, () => {
        const f = categoryAxisDataDeck({ kind, sources: sources(source) }),
          result = rendered(f.p, f.slide);
        expect(texts(result.labels.primary)).toEqual(letters("P", 4));
        expect(texts(result.labels.secondary)).toEqual(expected);
        expect(result.ticks.secondary).toHaveLength(5);
      });
    for (const [name, source, expected] of [
      ["absent", null, ["1", "2", "3", "4"]],
      ["present empty", { values: [] }, []],
      ["unresolved", { type: "strRef", cacheMissing: true, values: [] }, []],
    ])
      it(`${kind} distinguishes entirely ${name} category sources`, () => {
        const f = categoryAxisDataDeck({
            kind,
            sources: [source, source, source, source],
          }),
          result = rendered(f.p, f.slide);
        expect(texts(result.labels.primary)).toEqual(expected);
        expect(texts(result.labels.secondary)).toEqual(expected);
      });
    for (const type of ["numLit", "numRef"])
      for (const sourceLinked of [true, false])
        it(`${kind} formats its own ${type} with sourceLinked=${sourceLinked}`, () => {
          const f = categoryAxisDataDeck({
              kind,
              sourceLinked,
              sources: sources({
                type,
                format: "0.0%",
                values: [0.25, 0.5, 0.75, 1],
              }),
            }),
            result = rendered(f.p, f.slide);
          expect(texts(result.labels.primary)).toEqual(letters("P", 4));
          expect(texts(result.labels.secondary)).toEqual(
            sourceLinked
              ? ["25.0%", "50.0%", "75.0%", "100.0%"]
              : ["0.25", "0.50", "0.75", "1.00"],
          );
        });
    for (const swapPositions of [false, true])
      it(`${kind} binds cache roles independently of axis XML order and physical edge ${swapPositions}`, () => {
        const f = categoryAxisDataDeck({
            kind,
            reverseAxes: true,
            swapPositions,
          }),
          result = rendered(f.p, f.slide);
        expect(texts(result.labels.primary)).toEqual(letters("P", 4));
        expect(texts(result.labels.secondary)).toEqual(letters("S", 4));
      });
    it(`${kind} paints a category axis shared by two value systems once`, () => {
      const f = categoryAxisDataDeck({
          kind,
          shared: true,
          primaryCount: 4,
          secondaryCount: 6,
        }),
        result = rendered(f.p, f.slide);
      expect(texts(result.labels.primary)).toEqual(letters("P", 4));
      expect(result.labels.primary).toHaveLength(4);
      expect(result.labels.secondary).toEqual([]);
      expect(result.ticks.primary).toHaveLength(7);
      expect(result.ticks.secondary).toEqual([]);
      const view = chartRenderingView(f.shape);
      expect(view.axisLines.secondaryCategory.geometry.sharedWithPrimary).toBe(
        true,
      );
    });
    it(`${kind} keeps an unused primary axis independent of secondary text`, () => {
      const f = categoryAxisDataDeck({ kind, noPrimary: true }),
        result = rendered(f.p, f.slide);
      expect(texts(result.labels.primary)).toEqual(["1"]);
      expect(texts(result.labels.secondary)).toEqual(letters("S", 4));
    });
    for (const source of [
      null,
      { type: "strRef", cacheMissing: true, points: [] },
    ])
      it(`${kind} preserves ${source === null ? "absent" : "unresolved"} category sources through value edits and reimport`, async () => {
        const f = categoryAxisDataDeck({
          kind,
          sources: [source, undefined, source, undefined],
        });
        const before = categoryCaches(f.p, f.shape);
        const chart = P.getSlideCharts(f.slide)[0];
        P.setChartSpec(chart, {
          ...chart.spec,
          series: chart.spec.series.map((s) => ({
            ...s,
            values: s.values.map((v) => (v === null ? null : v + 1)),
          })),
        });
        expect(categoryCaches(f.p, f.shape)).toEqual(before);
        const reloaded = await P.loadPresentation(
          await P.savePresentation(f.p),
        );
        const copy = P.getSlideCharts(P.getSlides(reloaded)[0])[0];
        expect(categoryCaches(reloaded, copy.shape)).toEqual(before);
        const r = rendered(reloaded, P.getSlides(reloaded)[0]);
        expect(texts(r.labels.primary)).toEqual(letters("Q", 4));
        expect(texts(r.labels.secondary)).toEqual(letters("T", 4));
        expect(copy.spec.series[0].values[0]).toBe(16);
      });
    for (const nativeGroupOrder of kind === "column" ? [false, true] : [false])
      it(`${kind} retains separate caches through data/font edits, forward/return transfers and save/reimport (native group order ${nativeGroupOrder})`, async () => {
        const f = categoryAxisDataDeck({
            kind,
            ...(nativeGroupOrder ? { groupOrder: [0, 2, 1, 3] } : {}),
          }),
          original = P.getShapeChartSpec(f.shape),
          beforeBook = workbook(f.p, f.shape).data.slice(),
          beforeCaches = categoryCaches(f.p, f.shape);
        const retained = (p) => {
          const spec = P.getSlideCharts(P.getSlides(p)[0])[0].spec;
          expect(spec.categories).toEqual(original.categories);
          expect(
            categoryCaches(p, P.getSlideCharts(P.getSlides(p)[0])[0].shape),
          ).toEqual(beforeCaches);
          const r = rendered(p, P.getSlides(p)[0]);
          expect(texts(r.labels.primary)).toEqual(letters("P", 4));
          expect(texts(r.labels.secondary)).toEqual(letters("S", 4));
          expect(P.validatePresentation(p)).toEqual([]);
        };
        const stage = createDeck("blank");
        P.removeSlide(stage, P.getSlides(stage)[0]);
        P.importSlide(stage, f.slide, P.getSlideLayouts(stage)[0]);
        retained(stage);
        const copy = P.getSlideCharts(P.getSlides(stage)[0])[0];
        expect(workbook(stage, copy.shape).data).toEqual(beforeBook);
        P.setChartSpec(copy, {
          ...copy.spec,
          categoryAxisLabelStyle: {
            ...copy.spec.categoryAxisLabelStyle,
            sizePt: 16,
          },
          series: copy.spec.series.map((s) => ({
            ...s,
            values: s.values.map((v) => (v === null ? null : v + 1)),
          })),
        });
        retained(stage);
        retained(f.p);
        const reopened = await P.loadPresentation(
          await P.savePresentation(stage),
        );
        retained(reopened);
        const back = createDeck("blank");
        P.removeSlide(back, P.getSlides(back)[0]);
        P.importSlide(
          back,
          P.getSlides(reopened)[0],
          P.getSlideLayouts(back)[0],
        );
        retained(back);
        expect(P.getShapeChartSpec(f.shape)).toEqual(original);
        expect(workbook(f.p, f.shape).data).toEqual(beforeBook);
        expect(
          P._internalPackageOf(back).getPart(
            chartRoot(P.getSlideCharts(P.getSlides(back)[0])[0].shape),
          ),
        ).toBeTruthy();
      });
  }
  for (const kind of ["column", "bar", "line", "area"])
    for (const missingCategories of [false, true])
      it(`${kind} retains the native empty 0..1 domain with ${missingCategories ? "absent" : "empty"} category sources`, () => {
        const f = categoryAxisDataDeck({
          kind,
          primaryCount: 0,
          secondaryCount: 0,
          ...(missingCategories ? { sources: [null, null, null, null] } : {}),
        });
        const r = rendered(f.p, f.slide);
        const expectedTicks =
          kind === "area" ? [1] : kind === "bar" ? [0, 0.5] : [0.5, 1];
        for (const role of ["primary", "secondary"]) {
          expect(texts(r.labels[role])).toEqual(missingCategories ? ["1"] : []);
          const along = r.ticks[role]
            .map((e) =>
              kind === "bar"
                ? (number(e, "y1") - number(r.plot, "y")) /
                  number(r.plot, "height")
                : (number(e, "x1") - number(r.plot, "x")) /
                  number(r.plot, "width"),
            )
            .sort((a, b) => a - b);
          expect(along).toHaveLength(expectedTicks.length);
          along.forEach((value, i) =>
            expect(value).toBeCloseTo(expectedTicks[i], 3),
          );
        }
        expect(
          P.getShapeChartSpec(f.shape).series.every(
            (s) => s.values.length === 0,
          ),
        ).toBe(true);
      });
  it("reads only plotted sparse label slots, with last valid duplicate winning", () => {
    const f = categoryAxisDataDeck({
      sources: sources({
        count: 0xffffffff,
        points: [
          [0, "old"],
          [0, "current"],
          ["1x", "invalid"],
          [3, "last"],
          [0xffffffff, "outside"],
        ],
      }),
    });
    const view = chartRenderingView(f.shape);
    expect(view.axisLines.secondaryCategory.geometry.categoryData).toEqual({
      pointCount: 4,
      emptyDomain: false,
      labels: ["current", "", "", "last"],
      numberFormat: undefined,
    });
    expect(texts(rendered(f.p, f.slide).labels.secondary)).toEqual([
      "current",
      "last",
    ]);
  });
});
