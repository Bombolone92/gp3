import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartInversionDeck,
  nativeInvertedColor,
  inversionColors,
} from "./chart-inversion-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const part = (f) => P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
const xml = (f) => new TextDecoder().decode(part(f).data);
function bars(f) {
  const nodes = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(f.p, f.slide).split(",").slice(1).join(",")),
    ).root,
    (e) => {
      if (
        e.name.localName === "rect" &&
        [
          "#E85239",
          "#316BB0",
          "#FFFFFF",
          "#61A8B4",
          "#FEFFFF",
          "#000000",
          "#00AA66",
          "#CC8800",
        ].includes(attr(e, "fill"))
      )
        nodes.push(e);
    },
  );
  return nodes;
}
describe("native bar inversion", () => {
  // Independent native controls: values compare with the crossing for both
  // clustered and stacked charts; reversing the axis does not reverse paint.
  for (const kind of ["bar", "column"])
    for (const grouping of ["clustered", "stacked"])
      for (const inversion of [undefined, false, true])
        for (const [crossing, base] of [
          ["autoZero", 0],
          ["min", -8],
          ["max", 8],
          [{ at: 3 }, 3],
        ])
          for (const orientation of ["minMax", "maxMin"])
            it(`${kind} ${grouping} ${inversion} ${JSON.stringify(crossing)} ${orientation}`, () => {
              const f = chartInversionDeck({
                  kind,
                  grouping,
                  inversion,
                  crossing,
                  orientation,
                }),
                spec = P.getShapeChartSpec(f.shape),
                expected = [];
              for (let c = 0; c < 4; c++)
                for (let s = 0; s < 2; s++) {
                  const value = spec.series[s].values[c];
                  if (grouping === "clustered" && value === base) continue;
                  expected.push(
                    inversion !== false && value < base
                      ? "#FFFFFF"
                      : inversionColors[s],
                  );
                }
              const nodes = bars(f);
              expect(nodes.map((e) => attr(e, "fill"))).toEqual(expected);
              for (const e of nodes)
                if (attr(e, "fill") === "#FFFFFF") {
                  expect(attr(e, "stroke")).toBe("#000000");
                  expect(attr(e, "stroke-width")).toBe("1");
                }
            });
  for (const kind of ["bar", "column"])
    for (const grouping of ["clustered", "stacked"])
      for (const negativeColor of ["#61A8B4", "#FEFFFF", "#000000", "#FFFFFF"])
        it(`${kind} ${grouping} independent inverted color ${negativeColor}`, () => {
          const f = chartInversionDeck({
              kind,
              grouping,
              crossing: { at: 5 },
              negativeColor,
            }),
            nodes = bars(f);
          // Raw stacked value 4 in series 2 remains inverted although its endpoint is 6.
          expect(
            nodes.filter((e) => attr(e, "fill") === negativeColor),
          ).toHaveLength(7);
          for (const e of nodes.filter(
            (e) => attr(e, "fill") === negativeColor,
          ))
            expect(attr(e, "stroke")).toBe(
              negativeColor === "#FFFFFF" ? "#000000" : null,
            );
        });
  for (const kind of ["bar", "column"])
    for (const inversion of [false, true])
      it(`${kind} sparse point switches override series ${inversion}`, () => {
        const f = chartInversionDeck({
          kind,
          inversion,
          crossing: { at: 3 },
          negativeColor: "#61A8B4",
          pointInvertIfNegative: [!inversion, null, false],
          pointColors: ["#00AA66", null, "#CC8800"],
        });
        expect(
          P.getShapeChartSpec(f.shape).series[0].pointInvertIfNegative,
        ).toEqual([!inversion, , false]);
        expect(bars(f).map((e) => attr(e, "fill"))).toEqual([
          inversion ? "#00AA66" : "#FFFFFF",
          inversion ? "#00AA66" : "#FFFFFF",
          inversion ? "#61A8B4" : inversionColors[0],
          "#CC8800",
          "#CC8800",
          inversionColors[0],
          inversion ? "#61A8B4" : inversionColors[1],
        ]);
      });
  it("preserves native extension bodies, edits and clears only the represented color", () => {
    const f = chartInversionDeck();
    nativeInvertedColor(f);
    const original = xml(f),
      book = workbook(f.p, f.shape).data.slice();
    expect(P.getShapeChartSpec(f.shape).series[0].negativeColor).toBe(
      "#61A8B4",
    );
    const edit = (color) => {
      const chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        title: "Edited",
        series: chart.spec.series.map((s) => ({ ...s, negativeColor: color })),
      });
    };
    edit("#61A8B4");
    expect(xml(f)).toContain('flag="retain"');
    expect(xml(f)).toContain("urn:unrelated");
    edit("#FEFFFF");
    expect(P.getShapeChartSpec(f.shape).series[0].negativeColor).toBe(
      "#FEFFFF",
    );
    expect(xml(f)).toContain('flag="retain"');
    edit(undefined);
    expect(
      P.getShapeChartSpec(f.shape).series[0].negativeColor,
    ).toBeUndefined();
    expect(xml(f)).not.toContain("invertSolidFillFmt");
    expect(xml(f)).toContain("urn:unrelated");
    expect(workbook(f.p, f.shape).data).toEqual(book);
    expect(original).toContain("61A8B4");
  });
  for (const kind of ["bar", "column"])
    for (const grouping of ["clustered", "stacked", "percentStacked"])
      it(`${kind} ${grouping} copy/edit/export/return retains inverted paint and sparse switches`, async () => {
        const f = chartInversionDeck({
          kind,
          grouping,
          crossing: { at: 5 },
          pointInvertIfNegative: [false, null, true],
        });
        nativeInvertedColor(f);
        const original = xml(f),
          sourceSvg = preview(f.p, f.slide),
          sourceBook = workbook(f.p, f.shape).data.slice(),
          q = createDeck("blank"),
          copy = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
            preservePaintFormatting: true,
            preserveTextFormatting: true,
          });
        const chart = P.getSlideCharts(copy)[0];
        expect(chart.spec.series[0].negativeColor).toBe("#61A8B4");
        P.setChartSpec(chart, {
          ...chart.spec,
          series: chart.spec.series.map((s) => ({
            ...s,
            negativeColor: "#AA4499",
            pointInvertIfNegative: [true, null, false],
            values: s.values.map((v) => v + 1),
          })),
        });
        const saved = await P.loadPresentation(await P.savePresentation(q)),
          slide = P.getSlides(saved).at(-1),
          spec = P.getSlideCharts(slide)[0].spec;
        expect(spec.series[0].negativeColor).toBe("#AA4499");
        expect(spec.series[0].pointInvertIfNegative).toEqual([true, , false]);
        expect(preview(saved, slide)).toBe(preview(q, copy));
        expect(P.validatePresentation(saved)).toEqual([]);
        const back = P.importSlide(f.p, slide, P.getSlideLayouts(f.p)[0], {
          preservePaintFormatting: true,
          preserveTextFormatting: true,
        });
        expect(P.getSlideCharts(back)[0].spec).toEqual(spec);
        expect(xml(f)).toBe(original);
        expect(workbook(f.p, f.shape).data).toEqual(sourceBook);
        expect(preview(f.p, f.slide)).toBe(sourceSvg);
      });
  for (const field of ["negativeColor", "pointInvertIfNegative"])
    for (const invalid of field === "negativeColor"
      ? [null, "red", 17]
      : [true, [0], ["false"]])
      it(`rejects ${field} ${JSON.stringify(invalid)} before mutation`, () => {
        const f = chartInversionDeck(),
          before = xml(f),
          book = workbook(f.p, f.shape).data.slice(),
          chart = P.getSlideCharts(f.slide)[0];
        expect(() =>
          P.setChartSpec(chart, {
            ...chart.spec,
            series: chart.spec.series.map((s) => ({ ...s, [field]: invalid })),
          }),
        ).toThrow();
        expect(xml(f)).toBe(before);
        expect(workbook(f.p, f.shape).data).toEqual(book);
      });
});

it("retains native theme transforms on unchanged inverted paint", () => {
  const f = chartInversionDeck();
  nativeInvertedColor(
    f,
    '<a:schemeClr val="accent2"><a:tint val="50000"/></a:schemeClr>',
  );
  const chart = P.getSlideCharts(f.slide)[0];
  expect(chart.spec.series[0].negativeColor).toMatch(/^#[0-9A-F]{6}$/);
  P.setChartSpec(chart, { ...chart.spec, title: "Theme retained" });
  expect(xml(f)).toContain("schemeClr");
  expect(xml(f)).toContain("50000");
  expect(xml(f)).toContain('flag="retain"');
});
for (const [token, expected] of [
  ["0", false],
  ["false", false],
  [" true ", true],
  ["1", true],
  ["", undefined],
  ["FALSE", undefined],
])
  it(`reads sparse native point inversion ${JSON.stringify(token)} without coercion`, () => {
    const f = chartInversionDeck({ pointInvertIfNegative: [false] });
    part(f).data = new TextEncoder().encode(
      xml(f).replace(
        '<c:invertIfNegative val="0"/>',
        `<c:invertIfNegative val="${token}"/>`,
      ),
    );
    expect(
      P.getShapeChartSpec(f.shape).series[0].pointInvertIfNegative?.[0],
    ).toBe(expected);
  });
for (const kind of ["line", "area", "pie", "doughnut"])
  it(`${kind} does not author bar-specific inversion fields`, () => {
    const f = chartInversionDeck({
      kind,
      negativeColor: "#61A8B4",
      pointInvertIfNegative: [false, true],
    });
    expect(xml(f)).not.toContain("invertSolidFillFmt");
    expect(xml(f)).not.toContain("invertIfNegative");
  });
it("bounds sparse point materialization before writing chart/workbook parts", () => {
  const f = chartInversionDeck(),
    before = xml(f),
    chart = P.getSlideCharts(f.slide)[0],
    sparse = [];
  sparse.length = 8 * 1024 * 1024 + 1;
  expect(() =>
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [{ ...chart.spec.series[0], pointInvertIfNegative: sparse }],
    }),
  ).toThrow(/limit/);
  expect(xml(f)).toBe(before);
});

for (const kind of ["bar", "column"])
  for (const orientation of ["minMax", "maxMin"])
    for (const inversion of [false, true])
      for (const [crossing, paint] of [
        [
          "max",
          [
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
          ],
        ],
        [
          { at: 0.3 },
          [
            "#E85239",
            "#316BB0",
            "#E85239",
            "#316BB0",
            "#E85239",
            "#316BB0",
            "#E85239",
            "#316BB0",
          ],
        ],
        [
          { at: 1 },
          [
            "#E85239",
            "#316BB0",
            "#E85239",
            "#316BB0",
            "#E85239",
            "#316BB0",
            "#E85239",
            "#316BB0",
          ],
        ],
        [
          { at: 3 },
          [
            "#FFFFFF",
            "#FFFFFF",
            "#E85239",
            "#FFFFFF",
            "#E85239",
            "#FFFFFF",
            "#E85239",
            "#316BB0",
          ],
        ],
        [
          { at: 10 },
          [
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
            "#FFFFFF",
          ],
        ],
      ])
        it(`${kind} percent-stack ${orientation} ${inversion} raw crossing ${JSON.stringify(crossing)}`, () => {
          const f = chartInversionDeck({
            kind,
            grouping: "percentStacked",
            orientation,
            inversion,
            crossing,
            valueAxis: { min: 0, max: 1, majorUnit: 0.25 },
            series: [
              {
                name: "First",
                values: [2, 4, 3, 5],
                color: "#E85239",
                invertIfNegative: inversion,
              },
              {
                name: "Second",
                values: [1, 2, 1, 3],
                color: "#316BB0",
                invertIfNegative: inversion,
              },
            ],
          });
          expect(bars(f).map((e) => attr(e, "fill"))).toEqual(
            inversion
              ? paint
              : [
                  "#E85239",
                  "#316BB0",
                  "#E85239",
                  "#316BB0",
                  "#E85239",
                  "#316BB0",
                  "#E85239",
                  "#316BB0",
                ],
          );
        });

for (const kind of ["bar", "column"])
  for (const [crossing, expected] of [
    [
      "max",
      [
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
      ],
    ],
    [
      "min",
      [
        "#E85239",
        "#316BB0",
        "#E85239",
        "#316BB0",
        "#E85239",
        "#316BB0",
        "#E85239",
        "#316BB0",
      ],
    ],
    [
      "autoZero",
      [
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#316BB0",
        "#E85239",
        "#316BB0",
        "#E85239",
        "#FFFFFF",
      ],
    ],
    [
      { at: 1 },
      [
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#316BB0",
        "#E85239",
        "#316BB0",
        "#E85239",
        "#FFFFFF",
      ],
    ],
    [
      { at: 3 },
      [
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#316BB0",
        "#FFFFFF",
        "#316BB0",
        "#E85239",
        "#FFFFFF",
      ],
    ],
    [
      { at: 10 },
      [
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
        "#FFFFFF",
      ],
    ],
    [
      { at: -10 },
      [
        "#E85239",
        "#316BB0",
        "#E85239",
        "#316BB0",
        "#E85239",
        "#316BB0",
        "#E85239",
        "#316BB0",
      ],
    ],
  ])
    it(`${kind} stacked inversion retains the authored crossing beyond clipped bounds ${JSON.stringify(crossing)}`, () => {
      const f = chartInversionDeck({
        kind,
        grouping: "stacked",
        crossing,
        valueAxis: { min: -2, max: 2, majorUnit: 1 },
      });
      expect(bars(f).map((e) => attr(e, "fill"))).toEqual(expected);
    });
