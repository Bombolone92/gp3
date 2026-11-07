import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartRoot,
  workbook,
  chartNumberFormatDeck,
} from "./chart-copy-fixture.js";
import { buildEmbeddedXlsx } from "../lib/pptx/src/internal/chartml/embedded-xlsx.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  getAttrValue,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const elements = (e, n) =>
  e.children.filter(
    (x) => x.kind === "element" && (!n || x.name.localName === n),
  );
const kinds = ["column", "bar", "line", "area", "pie", "doughnut"];
function fixture(kind = "column", extra = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const shape = P.addSlideChart(slide, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(7),
    h: P.inches(4),
    spec: {
      kind,
      categories: ["0.125", "", "-0.25"],
      categoryNumberFormat: "0.0%",
      series: [
        {
          name: "Units",
          values: [0.2, null, -0.4, 0.8],
          numberFormat: '"$"#,##0.00',
          dataLabels: {
            showValue: true,
            numberFormat: "0.00",
            numberFormatSourceLinked: true,
          },
        },
      ],
      dataLabels: {
        showValue: true,
        numberFormat: "General",
        numberFormatSourceLinked: true,
      },
      categoryAxisNumberFormat: "0",
      categoryAxisNumberFormatSourceLinked: true,
      valueAxis: { numberFormat: "General", numberFormatSourceLinked: true },
      ...extra,
    },
  });
  return {
    p,
    slide,
    shape,
    part: P._internalPackageOf(p).getPart(chartRoot(shape)),
  };
}
function doc(f) {
  return parseXml(new TextDecoder().decode(f.part.data));
}
function edit(f, fn) {
  const d = doc(f);
  fn(d.root, child(child(d.root, "chart"), "plotArea"));
  f.part.data = new TextEncoder().encode(serializeXml(d));
}
function sheet(f) {
  return parseXml(
    strFromU8(
      unzipSync(workbook(f.p, f.shape).data)["xl/worksheets/sheet1.xml"],
    ),
  ).root;
}
function cell(f, address) {
  let result;
  walkElements(sheet(f), (e) => {
    if (e.name.localName === "c" && attr(e, "r") === address) result = e;
  });
  return result;
}
function cellFormat(f, address) {
  const zip = unzipSync(workbook(f.p, f.shape).data),
    c = cell(f, address);
  const style = Number(attr(c, "s") ?? 0);
  if (!zip["xl/styles.xml"]) return "General";
  const root = parseXml(strFromU8(zip["xl/styles.xml"])).root,
    ns = root.name.namespaceURI;
  const xfs = elements(child(root, "cellXfs", ns), "xf"),
    id = attr(xfs[style], "numFmtId");
  if (id === "0") return "General";
  return attr(
    elements(child(root, "numFmts", ns), "numFmt").find(
      (x) => attr(x, "numFmtId") === id,
    ),
    "formatCode",
  );
}
function formats(s) {
  return [
    s.categoryNumberFormat,
    s.series.map((x) => [
      x.numberFormat,
      x.dataLabels?.numberFormat,
      x.dataLabels?.numberFormatSourceLinked,
    ]),
    s.valueAxis?.numberFormat,
    s.valueAxis?.numberFormatSourceLinked,
    s.categoryAxisNumberFormat,
    s.categoryAxisNumberFormatSourceLinked,
    s.dataLabels?.numberFormat,
    s.dataLabels?.numberFormatSourceLinked,
  ];
}
function texts(f) {
  const out = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) => {
    if (e.name.localName === "text")
      out.push(
        e.children
          .filter((x) => x.kind === "text")
          .map((x) => x.data)
          .join(""),
      );
  });
  return out;
}
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((x) => [x.name, x.data.slice()]);
describe("native chart number formats and source links", () => {
  it.each(["pie", "doughnut"])(
    "%s formats numeric category legends without a category axis",
    (kind) => {
      const f = fixture(kind, {
          categories: ["0.125", "0.25", "0.5"],
          legend: { position: "r" },
        }),
        labels = texts(f);
      expect(labels).toContain("12.5%");
      expect(labels).toContain("25.0%");
      expect(labels).toContain("50.0%");
      expect(P.getShapeChartSpec(f.shape).categories).toEqual([
        "0.125",
        "0.25",
        "0.5",
      ]);
    },
  );

  it.each([true, false])(
    "keeps General category and value labels unabridged with sourceLinked=%s",
    (linked) => {
      const f = fixture("column", {
        categories: ["1234", "12345", "0.12345"],
        categoryNumberFormat: "General",
        categoryAxisNumberFormat: "General",
        categoryAxisNumberFormatSourceLinked: linked,
        series: [
          {
            name: "Count",
            values: [1234, 12345, 7],
            numberFormat: "General",
            dataLabels: {
              showValue: true,
              numberFormat: "General",
              numberFormatSourceLinked: linked,
            },
          },
        ],
      });
      const labels = texts(f);
      expect(labels.filter((x) => x === "1234")).toHaveLength(2);
      expect(labels.filter((x) => x === "12345")).toHaveLength(2);
      expect(labels).toContain("0.12345");
    },
  );

  for (const kind of kinds)
    for (const [code, linked] of [
      ["General", true],
      ["0.00", false],
      ["", true],
      ['"A&B <units>"0.0', false],
    ])
      it(`${kind} retains ${JSON.stringify(code)} / ${linked} through data edits and export`, async () => {
        const f = fixture(kind, {
            valueAxis: { numberFormat: code, numberFormatSourceLinked: linked },
            categoryAxisNumberFormat: code,
            categoryAxisNumberFormatSourceLinked: linked,
            dataLabels: {
              showValue: true,
              numberFormat: code,
              numberFormatSourceLinked: linked,
            },
          }),
          before = P.getShapeChartSpec(f.shape);
        expect(formats(before)).toEqual([
          "0.0%",
          [['"$"#,##0.00', "0.00", true]],
          kind === "pie" || kind === "doughnut" ? undefined : code,
          kind === "pie" || kind === "doughnut" ? undefined : linked,
          kind === "pie" || kind === "doughnut" ? undefined : code,
          kind === "pie" || kind === "doughnut" ? undefined : linked,
          code,
          linked,
        ]);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...before,
          series: before.series.map((s) => ({
            ...s,
            values: s.values.map((v) => (v === null ? null : v + 0.1)),
          })),
        });
        const after = P.getShapeChartSpec(f.shape);
        expect(formats(after)).toEqual(formats(before));
        expect(after.categories).toEqual(before.categories);
        expect(after.series[0].values).toEqual([
          0.30000000000000004,
          null,
          -0.30000000000000004,
          0.9,
        ]);
        expect(cellFormat(f, "A2")).toBe("0.0%");
        expect(cellFormat(f, "B2")).toBe('"$"#,##0.00');
        expect(cell(f, "A3")).toBeUndefined();
        expect(cell(f, "B3")).toBeUndefined();
        expect(attr(cell(f, "A2"), "t")).toBeNull();
        const saved = await P.loadPresentation(await P.savePresentation(f.p));
        expect(P.getSlideCharts(P.getSlides(saved)[0])[0].spec).toEqual(after);
        expect(P.validatePresentation(saved)).toEqual([]);
      });
  it.each(["1", "true", " 1 ", "0", "false", undefined, "invalid"])(
    "reads native sourceLinked=%j independently without mutating input",
    (linked) => {
      const f = fixture();
      edit(f, (_, plot) => {
        const nf = child(child(plot, "valAx"), "numFmt");
        nf.attrs = nf.attrs.filter((a) => a.name.localName !== "sourceLinked");
        if (linked !== undefined)
          nf.attrs.push({ name: qname("", "sourceLinked", ""), value: linked });
      });
      const original = f.part.data.slice(),
        s = P.getShapeChartSpec(f.shape);
      expect(s.valueAxis.numberFormat).toBe("General");
      expect(s.valueAxis.numberFormatSourceLinked).toBe(
        linked === undefined || ["1", "true", " 1 "].includes(linked)
          ? true
          : ["0", "false"].includes(linked)
            ? false
            : undefined,
      );
      expect(f.part.data).toEqual(original);
    },
  );
  it("keeps absent number-format nodes absent while retaining non-General source caches", () => {
    const f = fixture();
    edit(f, (_, plot) => {
      for (const axis of elements(plot).filter((e) =>
        ["catAx", "valAx"].includes(e.name.localName),
      ))
        axis.children = axis.children.filter(
          (e) => e.kind !== "element" || e.name.localName !== "numFmt",
        );
    });
    const s = P.getShapeChartSpec(f.shape);
    expect(s.valueAxis.numberFormat).toBeUndefined();
    expect(s.valueAxis.sourceNumberFormat).toBe('"$"#,##0.00');
    expect(s.categoryAxisSourceNumberFormat).toBe("0.0%");
    P.setChartSpec(P.getSlideCharts(f.slide)[0], s);
    const plot = child(child(doc(f).root, "chart"), "plotArea");
    expect(child(child(plot, "valAx"), "numFmt")).toBeNull();
    expect(child(child(plot, "catAx"), "numFmt")).toBeNull();
  });
  it("formats linked numeric categories, values and per-series labels from distinct caches", () => {
    const f = fixture();
    let labels = texts(f);
    expect(labels).toContain("12.5%");
    expect(labels).toContain("-25.0%");
    expect(labels).toContain("$0.20");
    const s = P.getShapeChartSpec(f.shape);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...s,
      categoryAxisNumberFormatSourceLinked: false,
      valueAxis: {
        ...s.valueAxis,
        numberFormat: "0%",
        numberFormatSourceLinked: false,
      },
      series: [
        {
          ...s.series[0],
          dataLabels: {
            showValue: true,
            numberFormat: "0.0%",
            numberFormatSourceLinked: false,
          },
        },
      ],
    });
    labels = texts(f);
    expect(labels).toContain("20.0%");
    expect(labels).not.toContain("$0.20");
    expect(labels).not.toContain("12.5%");
    expect(P.getShapeChartSpec(f.shape).categoryAxisNumberFormat).toBe("0");
  });
  it("inherits chart-level format links through per-series toggle-only overrides", () => {
    const f = fixture("column", {
      dataLabels: {
        showValue: true,
        numberFormat: "0",
        numberFormatSourceLinked: true,
      },
      series: [
        {
          name: "Rate",
          values: [0.2, 0.4],
          numberFormat: "0.0%",
          dataLabels: { showValue: true },
        },
      ],
    });
    expect(texts(f)).toContain("20.0%");
  });
  it("resolves primary and secondary source formats by native axis references despite shuffled XML", () => {
    const f = fixture("column", {
      series: [
        { name: "Rate", values: [0.2, 0.4], numberFormat: "0.0%" },
        {
          name: "Cost",
          values: [20, 40],
          numberFormat: '"$"0',
          chartKind: "line",
          secondaryAxis: true,
        },
      ],
      secondaryValueAxisNumberFormat: "General",
      secondaryValueAxisNumberFormatSourceLinked: true,
      secondaryCategoryAxisNumberFormat: "0",
      secondaryCategoryAxisNumberFormatSourceLinked: false,
    });
    edit(f, (_, plot) => {
      const axes = elements(plot).filter((e) =>
        ["catAx", "valAx"].includes(e.name.localName),
      );
      plot.children = plot.children
        .filter((e) => !axes.includes(e))
        .concat(axes.reverse());
    });
    const s = P.getShapeChartSpec(f.shape);
    expect(s.valueAxis.sourceNumberFormat).toBe("0.0%");
    expect(s.secondaryValueAxisSourceNumberFormat).toBe('"$"0');
    expect(s.secondaryCategoryAxisNumberFormatSourceLinked).toBe(false);
    expect(texts(f)).toContain("$20");
    expect(texts(f)).toContain("20.0%");
    P.setChartSpec(P.getSlideCharts(f.slide)[0], s);
    expect(
      P.getShapeChartSpec(f.shape).secondaryValueAxisSourceNumberFormat,
    ).toBe('"$"0');
  });
  it("writes numeric category and value formats with deduplicated workbook styles and matching date system", () => {
    const f = fixture("line", {
      date1904: true,
      categoryNumberFormat: "yyyy-mm-dd",
      categories: ["1.25", "", "1e3"],
      series: [
        { name: "A", values: [1, null, 3], numberFormat: "0.0%" },
        { name: "B", values: [2, 4, 6], numberFormat: "0.0%" },
        { name: "C", values: [7, 8], numberFormat: "General" },
      ],
    });
    const zip = unzipSync(workbook(f.p, f.shape).data),
      styles = parseXml(strFromU8(zip["xl/styles.xml"])).root,
      ns = styles.name.namespaceURI;
    expect(elements(child(styles, "numFmts", ns))).toHaveLength(2);
    expect(cellFormat(f, "A2")).toBe("yyyy-mm-dd");
    expect(cellFormat(f, "B2")).toBe("0.0%");
    expect(attr(cell(f, "C2"), "s")).toBe(attr(cell(f, "B2"), "s"));
    expect(cellFormat(f, "D2")).toBe("General");
    expect(strFromU8(zip["xl/workbook.xml"])).toContain('date1904="1"');
    expect(strFromU8(zip["xl/_rels/workbook.xml.rels"])).toContain(
      'Target="styles.xml"',
    );
    expect(strFromU8(zip["[Content_Types].xml"])).toContain("/xl/styles.xml");
    expect(P.getShapeChartSpec(f.shape).categories).toEqual([
      "1.25",
      "",
      "1000",
    ]);
  });
  it("retains the existing minimal workbook parts for ordinary General values", () => {
    const old = buildEmbeddedXlsx(
        ["Units"],
        [
          { label: "A", values: [5] },
          { label: "B", values: [null] },
        ],
      ),
      current = buildEmbeddedXlsx(
        ["Units"],
        [
          { label: "A", values: [5] },
          { label: "B", values: [null] },
        ],
        { seriesNumberFormats: ["General"] },
      );
    expect(unzipSync(current)).toEqual(unzipSync(old));
    expect(unzipSync(current)["xl/styles.xml"]).toBeUndefined();
  });
  it.each(kinds)(
    "%s retains formats through transfer both ways with independently editable workbooks",
    async (kind) => {
      const f = fixture(kind),
        s = P.getShapeChartSpec(f.shape),
        original = f.part.data.slice(),
        wb = workbook(f.p, f.shape).data.slice(),
        q = createDeck("blank");
      const to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
        }),
        copy = P.getSlideCharts(to)[0];
      expect(formats(copy.spec)).toEqual(formats(s));
      expect(workbook(q, copy.shape).data).toEqual(wb);
      const saved = await P.loadPresentation(await P.savePresentation(q)),
        back = P.importSlide(
          f.p,
          P.getSlides(saved).at(-1),
          P.getSlideLayout(f.slide),
          { preservePaintFormatting: true },
        ),
        returned = P.getSlideCharts(back)[0];
      expect(formats(returned.spec)).toEqual(formats(s));
      expect(chartRoot(returned.shape)).not.toBe(chartRoot(f.shape));
      expect(workbook(f.p, returned.shape).name).not.toBe(
        workbook(f.p, f.shape).name,
      );
      P.setChartSpec(returned, {
        ...returned.spec,
        series: [
          {
            ...returned.spec.series[0],
            values: [0.75, null, 0.25],
            numberFormat: "0.00%",
          },
        ],
      });
      expect(cellFormat({ ...f, shape: returned.shape }, "B2")).toBe("0.00%");
      expect(f.part.data).toEqual(original);
      expect(workbook(f.p, f.shape).data).toEqual(wb);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  for (const kind of ["scatter", "bubble", "radar"])
    for (const literal of [false, true])
      it(`${kind} reads independent ${literal ? "literal" : "reference"} channel formats and preserves native data both ways`, async () => {
        const f = fixture();
        edit(f, (_, plot) => {
          const group = child(plot, "barChart"),
            cat = child(plot, "catAx"),
            x = attr(child(cat, "axId"), "val"),
            y = attr(child(child(plot, "valAx"), "axId"), "val");
          const cache = (vals, fmt) => {
            const points = `<c:formatCode>${fmt}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}`;
            return literal
              ? `<c:numLit>${points}</c:numLit>`
              : `<c:numRef><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache>${points}</c:numCache></c:numRef>`;
          };
          const channels =
            kind === "radar"
              ? `<c:cat><c:strLit><c:ptCount val="3"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strLit></c:cat><c:val>${cache([0.2, 0.4, 0.6], "0.0%")}</c:val>`
              : `<c:xVal>${cache([0.1, 0.2, 0.4], "0.00%")}</c:xVal><c:yVal>${cache([0.2, 0.4, 0.6], "0.0%")}</c:yVal>${kind === "bubble" ? `<c:bubbleSize>${cache([2, 4, 3], "0.000")}</c:bubbleSize>` : ""}`;
          const native = parseXml(
            `<c:${kind}Chart xmlns:c="${NS.chart}">${kind === "scatter" ? '<c:scatterStyle val="lineMarker"/>' : kind === "radar" ? '<c:radarStyle val="standard"/>' : ""}<c:ser><c:idx val="0"/><c:order val="0"/>${channels}</c:ser><c:axId val="${x}"/><c:axId val="${y}"/></c:${kind}Chart>`,
          ).root;
          plot.children = plot.children.map((e) => (e === group ? native : e));
          if (kind !== "radar")
            plot.children = plot.children.map((e) =>
              e === cat
                ? parseXml(
                    `<c:valAx xmlns:c="${NS.chart}"><c:axId val="${x}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="${y}"/></c:valAx>`,
                  ).root
                : e,
            );
        });
        const s = P.getShapeChartSpec(f.shape),
          bytes = f.part.data.slice();
        expect(s.series[0].numberFormat).toBe("0.0%");
        expect(s.series[0].xNumberFormat).toBe(
          kind === "radar" ? undefined : "0.00%",
        );
        expect(s.series[0].bubbleSizeNumberFormat).toBe(
          kind === "bubble" ? "0.000" : undefined,
        );
        expect(s.valueAxis.sourceNumberFormat).toBe("0.0%");
        if (kind !== "radar") {
          expect(s.categoryAxisSourceNumberFormat).toBe("0.00%");
          expect(texts(f)).toContain("10.00%");
        }
        const loaded = await P.loadPresentation(await P.savePresentation(f.p)),
          q = createDeck("blank"),
          to = P.importSlide(
            q,
            P.getSlides(loaded)[0],
            P.getSlideLayouts(q)[0],
            { preservePaintFormatting: true },
          ),
          back = P.importSlide(f.p, to, P.getSlideLayout(f.slide), {
            preservePaintFormatting: true,
          });
        expect(P.getSlideCharts(to)[0].spec).toEqual(s);
        expect(P.getSlideCharts(back)[0].spec).toEqual(s);
        expect(f.part.data).toEqual(bytes);
        expect(P.validatePresentation(f.p)).toEqual([]);
      });
  for (const [label, mutate] of [
    ["value format", (s) => ({ ...s, valueAxis: { numberFormat: 7 } })],
    [
      "value link",
      (s) => ({ ...s, valueAxis: { numberFormatSourceLinked: "true" } }),
    ],
    ["category format", (s) => ({ ...s, categoryAxisNumberFormat: null })],
    [
      "category link",
      (s) => ({ ...s, categoryAxisNumberFormatSourceLinked: 1 }),
    ],
    [
      "secondary value format",
      (s) => ({ ...s, secondaryValueAxisNumberFormat: [] }),
    ],
    [
      "secondary value link",
      (s) => ({ ...s, secondaryValueAxisNumberFormatSourceLinked: null }),
    ],
    [
      "secondary category format",
      (s) => ({ ...s, secondaryCategoryAxisNumberFormat: false }),
    ],
    [
      "secondary category link",
      (s) => ({ ...s, secondaryCategoryAxisNumberFormatSourceLinked: {} }),
    ],
    [
      "cache format",
      (s) => ({ ...s, series: [{ ...s.series[0], numberFormat: 42 }] }),
    ],
    ["label format", (s) => ({ ...s, dataLabels: { numberFormat: null } })],
    [
      "label link",
      (s) => ({ ...s, dataLabels: { numberFormatSourceLinked: 0 } }),
    ],
    [
      "series label link",
      (s) => ({
        ...s,
        series: [
          { ...s.series[0], dataLabels: { numberFormatSourceLinked: "false" } },
        ],
      }),
    ],
    ["numeric category format", (s) => ({ ...s, categoryNumberFormat: 9 })],
  ])
    it(`rejects invalid ${label} before any package mutation`, () => {
      const f = fixture(),
        before = snapshot(f.p),
        s = P.getShapeChartSpec(f.shape);
      expect(() =>
        P.setChartSpec(P.getSlideCharts(f.slide)[0], mutate(s)),
      ).toThrow();
      expect(snapshot(f.p)).toEqual(before);
      expect(() =>
        P.addSlideChart(f.slide, {
          x: P.inches(1),
          y: P.inches(1),
          w: P.inches(2),
          h: P.inches(2),
          spec: mutate(s),
        }),
      ).toThrow();
      expect(snapshot(f.p)).toEqual(before);
    });
  it.each(["junk", "1tail", "0x10", "Infinity", "NaN"])(
    "rejects numeric category %s atomically",
    (value) => {
      const f = fixture(),
        before = snapshot(f.p),
        s = P.getShapeChartSpec(f.shape);
      expect(() =>
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...s,
          categories: [value],
        }),
      ).toThrow("numeric categories");
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it("provides distinct source-linked and fixed fixtures for actual editor clipboard checks", () => {
    const { p, slide } = chartNumberFormatDeck();
    const charts = P.getSlideCharts(slide);
    expect(charts).toHaveLength(2);
    expect(charts[0].spec.valueAxis.numberFormatSourceLinked).toBe(true);
    expect(charts[1].spec.valueAxis.numberFormatSourceLinked).toBe(false);
    expect(P.validatePresentation(p)).toEqual([]);
  });
});
