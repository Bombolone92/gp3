import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  walkElements,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const attribute = (e, n) => getAttrValue(e, qname("", n, ""));
const kinds = ["bar", "column", "line", "area", "pie", "doughnut"];
const fill = "#23916F",
  line = "#B63874";
function fixture(kind = "column", series = {}, spec = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(7),
      h: P.inches(4),
      spec: {
        kind,
        categories: ["Alpha", "Beta", "Gamma"],
        series: [{ name: "Units", values: [4, -2, 7], color: fill, ...series }],
        legend: { hiddenIndices: [0] },
        lineMarkers: true,
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
function edit(f, fn) {
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    plot = child(child(doc.root, "chart"), "plotArea");
  const group = plot.children.find(
    (e) =>
      e.kind === "element" &&
      e.name.namespaceURI === NS.chart &&
      e.name.localName.endsWith("Chart"),
  );
  fn(doc.root, plot, group, child(group, "ser"));
  f.part.data = new TextEncoder().encode(serializeXml(doc));
}
function nativeLine(f, color, width = "38100") {
  edit(f, (_, __, ___, series) => {
    const sp = child(series, "spPr");
    sp.children = sp.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.dml ||
        e.name.localName !== "ln",
    );
    const paint =
      color === null
        ? "<a:noFill/>"
        : `<a:solidFill>${color.startsWith("<") ? color : `<a:srgbClr val="${color.slice(1)}"/>`}</a:solidFill>`;
    sp.children.push(
      parseXml(
        `<a:ln xmlns:a="${NS.dml}"${width === undefined ? "" : ` w="${width}"`}>${paint}<a:prstDash val="dash"/></a:ln>`,
      ).root,
    );
  });
}
function rendered(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  return { svg, nodes };
}
function dataNodes(kind, nodes) {
  if (kind === "line" || kind === "scatter")
    return nodes.filter(
      (e) =>
        e.name.localName === "path" &&
        attribute(e, "fill") === "none" &&
        attribute(e, "d")?.startsWith("M"),
    );
  if (kind === "radar")
    return nodes.filter(
      (e) => e.name.localName === "polygon" && attribute(e, "fill") === fill,
    );
  if (kind === "bubble")
    return nodes.filter(
      (e) => e.name.localName === "circle" && attribute(e, "fill") === fill,
    );
  return nodes.filter(
    (e) =>
      (e.name.localName === "path" ||
        (e.name.localName === "rect" &&
          attribute(e, "width") !== attribute(e, "height"))) &&
      attribute(e, "fill") === fill,
  );
}
function expectStroke(f, kind, color, width) {
  const r = rendered(f),
    nodes = dataNodes(kind, r.nodes);
  expect(nodes.length).toBeGreaterThan(0);
  for (const node of nodes) {
    expect(attribute(node, "stroke")).toBe(color === null ? "none" : color);
    expect(Number(attribute(node, "stroke-width"))).toBeCloseTo(
      width / 9525,
      12,
    );
  }
  if (kind === "area")
    for (const node of nodes) expect(attribute(node, "d")).toMatch(/Z$/);
  expect(r.svg).not.toMatch(/NaN|Infinity/);
  return r;
}
function numericFixture(kind, color, width) {
  const f = fixture();
  edit(f, (_, plot, group) => {
    const cat = child(plot, "catAx"),
      val = child(plot, "valAx"),
      catId = attribute(child(cat, "axId"), "val"),
      valId = attribute(child(val, "axId"), "val");
    const cache = (values) =>
      `<c:numLit><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numLit>`;
    const style =
      kind === "scatter"
        ? '<c:scatterStyle val="lineMarker"/>'
        : kind === "radar"
          ? '<c:radarStyle val="filled"/>'
          : "";
    const channel =
      kind === "radar"
        ? `<c:cat><c:strLit><c:ptCount val="3"/><c:pt idx="0"><c:v>Alpha</c:v></c:pt><c:pt idx="1"><c:v>Beta</c:v></c:pt><c:pt idx="2"><c:v>Gamma</c:v></c:pt></c:strLit></c:cat><c:val>${cache([4, -2, 7])}</c:val>`
        : `<c:xVal>${cache([1, 2, 4])}</c:xVal><c:yVal>${cache([4, -2, 7])}</c:yVal>${kind === "bubble" ? `<c:bubbleSize>${cache([1, 3, 2])}</c:bubbleSize>` : ""}`;
    const native = parseXml(
      `<c:${kind}Chart xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${style}<c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="23916F"/></a:solidFill></c:spPr>${kind !== "bubble" ? '<c:marker><c:symbol val="circle"/></c:marker>' : ""}${channel}</c:ser><c:axId val="${catId}"/><c:axId val="${valId}"/></c:${kind}Chart>`,
    ).root;
    plot.children = plot.children.map((e) => (e === group ? native : e));
    if (kind !== "radar") {
      const x = parseXml(
        `<c:valAx xmlns:c="${NS.chart}"><c:axId val="${catId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="${valId}"/></c:valAx>`,
      ).root;
      plot.children = plot.children.map((e) => (e === cat ? x : e));
    }
  });
  nativeLine(f, color, String(width));
  return f;
}
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);
describe("independent native chart series outlines", () => {
  for (const kind of kinds)
    for (const color of [line, null])
      it(`${kind} reads native ${color ?? "noFill"} independently of its fill and keeps it through data edits`, async () => {
        const f = fixture(kind);
        nativeLine(f, color);
        const before = f.part.data.slice(),
          spec = P.getShapeChartSpec(f.shape);
        expect(spec.series[0]).toMatchObject({
          color: fill,
          lineColor: color,
          lineWidthEmu: 38100,
          lineDash: "dash",
        });
        expectStroke(f, kind, color, 38100);
        expect(f.part.data).toEqual(before);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...spec,
          series: spec.series.map((s) => ({
            ...s,
            values: s.values.map((v) => v + 1),
          })),
        });
        const edited = P.getShapeChartSpec(f.shape).series[0];
        expect(edited).toMatchObject({
          color: fill,
          lineColor: color,
          lineWidthEmu: 38100,
          lineDash: "dash",
          values: [5, -1, 8],
        });
        expectStroke(f, kind, color, 38100);
        const saved = await P.loadPresentation(await P.savePresentation(f.p));
        expect(
          P.getSlideCharts(P.getSlides(saved)[0])[0].spec.series[0],
        ).toEqual(edited);
      });
  for (const kind of kinds)
    for (const color of [line, null])
      it.each([0, 1, 9525, 38100])(
        `${kind} authors independent ${color ?? "noFill"} outlines at %s EMU without clamping`,
        (width) => {
          const f = fixture(kind, {
            lineColor: color,
            lineWidthEmu: width,
            lineDash: "dash",
          });
          expect(P.getShapeChartSpec(f.shape).series[0]).toMatchObject({
            color: fill,
            lineColor: color,
            lineWidthEmu: width,
          });
          expectStroke(f, kind, color, width);
        },
      );
  for (const kind of ["scatter", "bubble", "radar"])
    for (const color of [line, null])
      it.each([0, 1, 38100])(
        `${kind} reads and transfers independent ${color ?? "noFill"} outlines at %s EMU`,
        async (width) => {
          const f = numericFixture(kind, color, width),
            native = f.part.data.slice(),
            spec = P.getShapeChartSpec(f.shape);
          expect(spec.series[0]).toMatchObject({
            color: fill,
            lineColor: color,
            lineWidthEmu: width,
          });
          expectStroke(f, kind, color, width);
          expect(f.part.data).toEqual(native);
          const q = createDeck("blank"),
            to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
            back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
          for (const slide of [to, back])
            expect(P.getSlideCharts(slide)[0].spec).toEqual(spec);
          const saved = await P.loadPresentation(await P.savePresentation(q));
          expect(P.getSlideCharts(P.getSlides(saved).at(-1))[0].spec).toEqual(
            spec,
          );
          expect(P.validatePresentation(saved)).toEqual([]);
        },
      );
  it.each([
    "-1",
    "20116801",
    "Infinity",
    "NaN",
    "9525x",
    "9525.0",
    "1e4",
    "",
    "0x10",
  ])(
    "retains malformed native line width %j without interpreting an integer prefix",
    (raw) => {
      const f = fixture("line");
      nativeLine(f, line, raw);
      const before = f.part.data.slice();
      expect(
        P.getShapeChartSpec(f.shape).series[0].lineWidthEmu,
      ).toBeUndefined();
      expect(P.getShapeChartSpec(f.shape).series[0].lineColor).toBe(line);
      rendered(f);
      expect(f.part.data).toEqual(before);
    },
  );
  for (const kind of ["bar", "line"])
    it.each(["__proto__", "constructor", "future-dash"])(
      `${kind} preserves data and native XML for an unrecognized dash %j`,
      (raw) => {
        const f = fixture(kind);
        nativeLine(f, line);
        edit(f, (_, __, ___, ser) => {
          const dash = child(
            child(child(ser, "spPr"), "ln", NS.dml),
            "prstDash",
            NS.dml,
          );
          dash.attrs[0].value = raw;
        });
        const native = f.part.data.slice(),
          r = rendered(f);
        expect(dataNodes(kind, r.nodes).length).toBeGreaterThan(0);
        expect(r.svg).toContain("Alpha");
        expect(r.svg).toContain("Gamma");
        expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
          4, -2, 7,
        ]);
        expect(f.part.data).toEqual(native);
      },
    );
  it.each([
    ['<a:prstClr val="darkOrchid"/>', "#9932CC"],
    ['<a:srgbClr val="FF0000"><a:inv/></a:srgbClr>', "#00FFFF"],
  ])(
    "resolves native outline colors and transforms: %s",
    (native, expected) => {
      const f = fixture("bar");
      nativeLine(f, native);
      expect(P.getShapeChartSpec(f.shape).series[0].lineColor).toBe(expected);
      expectStroke(f, "bar", expected, 38100);
    },
  );
  it.each([-1, 20116801, NaN, Infinity, null, "9525"])(
    "rejects authored line width %j before package mutation",
    (width) => {
      const f = fixture(),
        before = snapshot(f.p);
      expect(() =>
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...P.getShapeChartSpec(f.shape),
          series: [{ name: "Units", values: [4, -2, 7], lineWidthEmu: width }],
        }),
      ).toThrow("lineWidthEmu");
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it.each(["#GGGGGG", 42])(
    "rejects authored outline paint %j before package mutation",
    (color) => {
      const f = fixture(),
        before = snapshot(f.p);
      expect(() =>
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...P.getShapeChartSpec(f.shape),
          series: [{ name: "Units", values: [4, -2, 7], lineColor: color }],
        }),
      ).toThrow("lineColor");
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it("retains the maximum ST_LineWidth boundary", () => {
    const f = fixture("column", { lineColor: line, lineWidthEmu: 20116800 });
    expect(P.getShapeChartSpec(f.shape).series[0].lineWidthEmu).toBe(20116800);
    expectStroke(f, "column", line, 20116800);
  });
  it("keeps data, fill, markers and labels when a line explicitly has no outline", () => {
    const f = fixture("line", {
      lineColor: null,
      markerSymbol: "circle",
      dataLabels: { showValue: true },
    });
    const r = rendered(f);
    expect(
      dataNodes("line", r.nodes).every(
        (e) => attribute(e, "stroke") === "none",
      ),
    ).toBe(true);
    expect(
      r.nodes.filter(
        (e) => e.name.localName === "circle" && attribute(e, "fill") === fill,
      ),
    ).toHaveLength(3);
    expect(r.svg).toContain(">7</text>");
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([4, -2, 7]);
  });
  for (const base of ["column", "line", "area"])
    for (const kind of ["column", "line", "area"])
      it.each(["standard", "clustered"])(
        `${base} base serializes ${kind} series appearance and grouping %s by its own plot kind`,
        (grouping) => {
          const f = fixture(
            base,
            {},
            {
              grouping,
              series: [
                { name: "Primary", color: fill, values: [2, 4, 7] },
                {
                  name: "Override",
                  chartKind: kind,
                  color: fill,
                  lineColor: line,
                  lineWidthEmu: 38100,
                  markerSymbol: "circle",
                  smooth: true,
                  invertIfNegative: true,
                  values: [3, 6, 1],
                },
              ],
            },
          );
          const doc = parseXml(new TextDecoder().decode(f.part.data)),
            elements = [];
          walkElements(doc.root, (e) => elements.push(e));
          const ser = elements.find(
            (e) =>
              e.name.namespaceURI === NS.chart &&
              e.name.localName === "ser" &&
              attribute(child(e, "idx"), "val") === "1",
          );
          expect(!!child(ser, "marker")).toBe(kind === "line");
          expect(!!child(ser, "smooth")).toBe(kind === "line");
          expect(!!child(ser, "invertIfNegative")).toBe(kind === "column");
          for (const group of elements.filter(
            (e) =>
              e.name.namespaceURI === NS.chart &&
              ["barChart", "lineChart", "areaChart"].includes(e.name.localName),
          ))
            expect(attribute(child(group, "grouping"), "val")).toBe(
              group.name.localName === "barChart" ? grouping : "standard",
            );
        },
      );
  it("maps primary/secondary combo outlines by series and preserves independent edits after transfer/export", async () => {
    const f = fixture(
        "column",
        { lineColor: null },
        {
          series: [
            {
              name: "Primary",
              values: [4, -2, 7],
              color: fill,
              lineColor: null,
              lineWidthEmu: 0,
            },
            {
              name: "Secondary",
              chartKind: "line",
              secondaryAxis: true,
              values: [40, -20, 70],
              color: "#548BD2",
              lineColor: line,
              lineWidthEmu: 38100,
            },
          ],
          legend: { hiddenIndices: [0, 1] },
        },
      ),
      original = P.getShapeChartSpec(f.shape),
      native = f.part.data.slice();
    const q = createDeck("blank"),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
    expect(P.getSlideCharts(to)[0].spec).toEqual(original);
    expect(P.getSlideCharts(back)[0].spec).toEqual(original);
    expect(workbook(q, P.getSlideCharts(to)[0].shape).data).toEqual(
      workbook(f.p, f.shape).data,
    );
    const copy = P.getSlideCharts(back)[0];
    P.setChartSpec(copy, {
      ...copy.spec,
      series: copy.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 1),
      })),
    });
    expect(f.part.data).toEqual(native);
    expect(P.getShapeChartSpec(f.shape)).toEqual(original);
    const saved = await P.loadPresentation(await P.savePresentation(f.p));
    expect(
      P.getSlideCharts(P.getSlides(saved).at(-1))[0].spec.series.map((s) => [
        s.lineColor,
        s.lineWidthEmu,
      ]),
    ).toEqual([
      [null, 0],
      [line, 38100],
    ]);
    expect(P.validatePresentation(saved)).toEqual([]);
  });
  for (const kind of kinds)
    it(`${kind} retains omitted outline paint and width defaults`, () => {
      const f = fixture(kind),
        spec = P.getShapeChartSpec(f.shape).series[0],
        r = rendered(f);
      expect(spec.lineColor).toBe(kind === "line" ? fill : undefined);
      expect(spec.lineWidthEmu).toBeUndefined();
      const nodes = dataNodes(kind, r.nodes);
      if (kind === "bar" || kind === "column")
        for (const node of nodes) expect(attribute(node, "stroke")).toBeNull();
      if (kind === "line")
        for (const node of nodes) {
          expect(attribute(node, "stroke")).toBe(fill);
          expect(Number(attribute(node, "stroke-width"))).toBe(1.5);
        }
      if (kind === "pie" || kind === "doughnut")
        for (const node of nodes) {
          expect(attribute(node, "stroke")).toBe("#FFFFFF");
          expect(Number(attribute(node, "stroke-width"))).toBe(0.6);
        }
      expect(spec.values).toEqual([4, -2, 7]);
    });
  it.each([line, null])(
    "a plain line legend reflects its independent outline %j",
    (color) => {
      const f = fixture(
          "line",
          { lineColor: color, lineWidthEmu: 38100, markerSymbol: "none" },
          { lineMarkers: false, legend: { position: "b" } },
        ),
        r = rendered(f);
      const keyLines = r.nodes.filter(
        (e) =>
          e.name.localName === "line" &&
          attribute(e, "stroke") === (color === null ? "none" : color),
      );
      expect(keyLines).toHaveLength(1);
      expect(Number(attribute(keyLines[0], "stroke-width"))).toBe(4);
      expect(r.svg).toContain(">Units</text>");
    },
  );
  it("uses each visible legend entry's own outline after hidden-entry filtering", () => {
    const f = fixture(
        "column",
        {},
        {
          series: [
            {
              name: "Hidden",
              color: "#777777",
              lineColor: "#555555",
              values: [1, 2, 3],
            },
            {
              name: "Visible",
              color: fill,
              lineColor: line,
              lineWidthEmu: 38100,
              values: [4, -2, 7],
            },
          ],
          legend: { hiddenIndices: [0] },
        },
      ),
      r = rendered(f),
      keys = r.nodes.filter(
        (e) =>
          e.name.localName === "rect" &&
          attribute(e, "width") === attribute(e, "height") &&
          attribute(e, "fill") === fill,
      );
    expect(keys).toHaveLength(1);
    expect(attribute(keys[0], "stroke")).toBe(line);
    expect(Number(attribute(keys[0], "stroke-width"))).toBe(4);
    expect(r.svg).not.toContain(">Hidden</text>");
  });
});
