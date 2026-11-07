import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { buildChartSpaceDoc } from "../lib/pptx/src/internal/chartml/chart-builder.ts";
import {
  chartPlotContext,
  primaryChartAxis,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  getAttrValue,
  qname,
  elem,
  attr,
} from "../lib/pptx/src/internal/xml/index.ts";

const fields = [
    "categoryAxisTickLabelPos",
    "valueAxisTickLabelPos",
    "secondaryCategoryAxisTickLabelPos",
    "secondaryValueAxisTickLabelPos",
  ],
  modes = ["none", "low", "high", "nextTo"],
  c = (name) => qname("c", name, NS.chart),
  val = qname("", "val", ""),
  child = (e, n) => firstChildElement(e, c(n)),
  settings = (spec) => Object.fromEntries(fields.map((k) => [k, spec[k]])),
  base = (kind = "column") => ({
    kind,
    categories: ["East", "West", "North"],
    series: [
      { name: "Primary", values: [2, null, -3] },
      {
        name: "Secondary",
        values: [20, 40, 30],
        secondaryAxis: true,
        chartKind: kind === "column" ? "line" : kind,
      },
    ],
  }),
  options = (spec) => ({
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(7),
    h: P.inches(4),
    spec,
  }),
  requested = (shift = 0) =>
    Object.fromEntries(
      fields.map((k, i) => [k, modes[(i + shift) % modes.length]]),
    );
function fixture(spec = { ...base(), ...requested() }) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, options(spec));
  return { p, slide, shape };
}
const part = (f) => P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
function axes(root) {
  const ctx = chartPlotContext(root);
  return [
    primaryChartAxis(ctx, ["catAx", "dateAx", "serAx"]),
    primaryChartAxis(ctx, ["valAx"]),
    ctx.axes.axisForGroups(["catAx", "dateAx", "serAx"], true),
    ctx.axes.axisForGroups(["valAx"], true),
  ];
}
const raw = (f) =>
  axes(parseXml(new TextDecoder().decode(part(f).data)).root).map((a) => {
    const node = child(a, "tickLblPos");
    return node ? [getAttrValue(node, val)] : null;
  });
function mutate(f, fn) {
  const doc = parseXml(new TextDecoder().decode(part(f).data));
  fn(axes(doc.root), doc.root);
  part(f).data = new TextEncoder().encode(serializeXml(doc));
}
function replace(axis, value) {
  axis.children = axis.children.filter(
    (n) =>
      n.kind !== "element" ||
      n.name.namespaceURI !== NS.chart ||
      n.name.localName !== "tickLblPos",
  );
  if (value === undefined) return;
  const index = axis.children.indexOf(child(axis, "crossAx"));
  axis.children.splice(
    index,
    0,
    elem(c("tickLblPos"), { attrs: value === null ? [] : [attr(val, value)] }),
  );
}
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((p) => [
    p.name,
    p.contentType,
    p.data.slice(),
  ]);

describe("independent native chart axis label positions", () => {
  for (const kind of ["column", "bar", "line", "area"])
    for (let shift = 0; shift < modes.length; shift++)
      it(`${kind} retains all four positions through edits, independent copies, and reimport (${shift})`, async () => {
        const expected = requested(shift),
          f = fixture({ ...base(kind), ...expected }),
          book = workbook(f.p, f.shape).data.slice();
        expect(settings(P.getShapeChartSpec(f.shape))).toEqual(expected);
        const native = raw(f);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...P.getShapeChartSpec(f.shape),
          title: "Unrelated edit",
        });
        expect(raw(f)).toEqual(native);
        expect(workbook(f.p, f.shape).data).toEqual(book);
        const q = createDeck("blank"),
          copy = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
          back = P.importSlide(f.p, copy, P.getSlideLayout(f.slide)),
          edited = P.getSlideCharts(back)[0],
          sourceXml = part(f).data.slice();
        expect(settings(P.getSlideCharts(copy)[0].spec)).toEqual(expected);
        expect(settings(edited.spec)).toEqual(expected);
        P.setChartSpec(edited, {
          ...edited.spec,
          valueAxisTickLabelPos: modes[(shift + 2) % 4],
          secondaryCategoryAxisTickLabelPos: modes[(shift + 1) % 4],
          series: edited.spec.series.map((s) => ({
            ...s,
            values: s.values.map((v) => (v === null ? null : v + 0.25)),
          })),
        });
        expect(part(f).data).toEqual(sourceXml);
        expect(workbook(f.p, f.shape).data).toEqual(book);
        const reopened = await parseDeck(await P.savePresentation(f.p)),
          charts = P.getSlides(reopened).flatMap((s) => P.getSlideCharts(s));
        expect(settings(charts[0].spec)).toEqual(expected);
        expect(settings(charts[1].spec)).toEqual({
          ...expected,
          valueAxisTickLabelPos: modes[(shift + 2) % 4],
          secondaryCategoryAxisTickLabelPos: modes[(shift + 1) % 4],
        });
        expect(charts[1].spec.series[0].values).toEqual([2.25, null, -2.75]);
        expect(
          new Set(charts.map((c) => workbook(reopened, c.shape).name)).size,
        ).toBe(2);
        expect(P.validatePresentation(reopened)).toEqual([]);
      });

  for (const [i, field] of fields.entries()) {
    it(`${field} edits and clears only its own position`, () => {
      const f = fixture(),
        before = raw(f);
      for (const mode of [...modes, undefined]) {
        const chart = P.getSlideCharts(f.slide)[0];
        P.setChartSpec(chart, { ...chart.spec, [field]: mode });
        expect(P.getShapeChartSpec(f.shape)[field]).toBe(mode);
        raw(f).forEach((node, j) => {
          if (i !== j) expect(node).toEqual(before[j]);
        });
        if (mode === undefined) expect(raw(f)[i]).toBeNull();
      }
    });
    for (const value of [null, "", "nextto", "HIGH", " low ", false, 0, [], {}])
      it(`${field} rejects ${JSON.stringify(value)} before mutation`, () => {
        const f = fixture(),
          before = snapshot(f.p),
          paint = preview(f.p, f.slide),
          spec = { ...P.getShapeChartSpec(f.shape), [field]: value };
        expect(() =>
          P.setChartSpec(P.getSlideCharts(f.slide)[0], spec),
        ).toThrow(new RegExp(field));
        expect(snapshot(f.p)).toEqual(before);
        expect(preview(f.p, f.slide)).toBe(paint);
        const p = createDeck("blank"),
          original = snapshot(p);
        expect(() => P.addSlideChart(P.getSlides(p)[0], options(spec))).toThrow(
          new RegExp(field),
        );
        expect(snapshot(p)).toEqual(original);
        expect(() => buildChartSpaceDoc(spec)).toThrow(new RegExp(field));
      });
    for (const [token, expected] of [
      [undefined, undefined],
      [null, "nextTo"],
      ["", undefined],
      ["other", undefined],
      ["HIGH", undefined],
      [" low ", undefined],
    ])
      it(`${field} retains native ${JSON.stringify(token)} on an unrelated edit`, async () => {
        const f = fixture();
        mutate(f, (a) => replace(a[i], token));
        const native = raw(f),
          bytes = part(f).data.slice(),
          chart = P.getSlideCharts(f.slide)[0];
        expect(chart.spec[field]).toBe(expected);
        const q = await parseDeck(await P.savePresentation(f.p));
        expect(
          part({ p: q, shape: P.getSlideCharts(P.getSlides(q)[0])[0].shape })
            .data,
        ).toEqual(bytes);
        P.setChartSpec(chart, {
          ...chart.spec,
          title: "Retain native representation",
        });
        expect(raw(f)).toEqual(native);
      });
    it(`${field} preserves inherited namespace bindings and unknown native content`, () => {
      const f = fixture();
      mutate(f, (a, root) => {
        root.prefixDecls.set("choice", "urn:owned:label-choice");
        a[i].prefixDecls.set("native", "urn:owned:label-metadata");
        const node = child(a[i], "tickLblPos");
        node.attrs.push(
          attr(
            qname("native", "option", "urn:owned:label-metadata"),
            "choice:keep",
          ),
        );
        node.children.push(
          elem(qname("native", "payload", "urn:owned:label-metadata")),
        );
      });
      const chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, { ...chart.spec, title: "Preserve metadata" });
      const node = child(
        axes(parseXml(new TextDecoder().decode(part(f).data)).root)[i],
        "tickLblPos",
      );
      expect(
        getAttrValue(
          node,
          qname("native", "option", "urn:owned:label-metadata"),
        ),
      ).toBe("choice:keep");
      expect(node.prefixDecls.get("choice")).toBe("urn:owned:label-choice");
      expect(
        firstChildElement(
          node,
          qname("native", "payload", "urn:owned:label-metadata"),
        ),
      ).toBeTruthy();
    });
  }
  for (const kind of ["scatter", "bubble"])
    for (const reversed of [false, true])
      it(`reads all four native ${kind} coordinates with reordered axes=${reversed}`, async () => {
        const f = fixture(),
          expected = requested();
        mutate(f, (a, root) => {
          const ctx = chartPlotContext(root);
          const groups = ctx.area.children.filter(
            (n) =>
              n.kind === "element" &&
              ["barChart", "lineChart"].includes(n.name.localName),
          );
          for (const [i, group] of groups.entries()) {
            const cache = (values) =>
              `<c:numLit><c:ptCount val="${values.length}"/>${values.map((v, j) => `<c:pt idx="${j}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numLit>`;
            const native = parseXml(
              `<c:${kind}Chart xmlns:c="${NS.chart}"><c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:xVal>${cache([1, 2, 3])}</c:xVal><c:yVal>${cache([4, 9, -2])}</c:yVal>${kind === "bubble" ? `<c:bubbleSize>${cache([2, 3, 4])}</c:bubbleSize>` : ""}</c:ser><c:axId val="${getAttrValue(child(a[2 * i], "axId"), val)}"/><c:axId val="${getAttrValue(child(a[2 * i + 1], "axId"), val)}"/></c:${kind}Chart>`,
            ).root;
            ctx.area.children[ctx.area.children.indexOf(group)] = native;
            a[2 * i].name = c("valAx");
            child(a[2 * i], "axPos").attrs[0].value = "t";
            child(a[2 * i + 1], "axPos").attrs[0].value = "r";
          }
          if (reversed) {
            ctx.area.children = ctx.area.children.filter((n) => !a.includes(n));
            ctx.area.children.push(...a.slice().reverse());
          }
        });
        expect(settings(P.getShapeChartSpec(f.shape))).toEqual(expected);
        const q = await parseDeck(await P.savePresentation(f.p));
        expect(settings(P.getSlideCharts(P.getSlides(q)[0])[0].spec)).toEqual(
          expected,
        );
      });
  it("ignores foreign tickLblPos and foreign val attributes", () => {
    const f = fixture();
    mutate(f, (a) => {
      child(a[0], "tickLblPos").name = qname(
        "other",
        "tickLblPos",
        "urn:foreign",
      );
      child(a[1], "tickLblPos").attrs = [
        attr(qname("other", "val", "urn:foreign"), "none"),
      ];
    });
    expect(
      P.getShapeChartSpec(f.shape).categoryAxisTickLabelPos,
    ).toBeUndefined();
    expect(P.getShapeChartSpec(f.shape).valueAxisTickLabelPos).toBe("nextTo");
  });
  for (const axisType of ["catAx", "dateAx", "serAx"])
    it(`resolves referenced ${axisType} and value pairs regardless of XML order or unrelated axes`, () => {
      const f = fixture(),
        expected = requested();
      mutate(f, (a, root) => {
        a[0].name = c(axisType);
        a[2].name = c(axisType);
        const ctx = chartPlotContext(root),
          extra = structuredClone(a[3]);
        child(extra, "axId").attrs[0].value = "987654321";
        replace(extra, "none");
        ctx.area.children = ctx.area.children.filter((n) => !a.includes(n));
        ctx.area.children.push(extra, ...a.slice().reverse());
      });
      expect(settings(P.getShapeChartSpec(f.shape))).toEqual(expected);
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...P.getShapeChartSpec(f.shape),
        title: "Referenced slots",
      });
      expect(settings(P.getShapeChartSpec(f.shape))).toEqual(expected);
    });
  for (const kind of ["column", "bar"])
    it(`${kind} authors tickLblPos in the common axis schema sequence`, () => {
      const f = fixture({
        ...base(kind),
        ...requested(),
        categoryAxisLineColor: "#123456",
        valueAxisLineColor: "#234567",
        secondaryCategoryAxisLineColor: "#345678",
        secondaryValueAxisLineColor: "#456789",
        categoryAxisMajorTickMark: "in",
        valueAxisMinorTickMark: "out",
        categoryAxisLabelStyle: { sizePt: 11 },
        valueAxisLabelStyle: { sizePt: 12 },
      });
      for (const axis of axes(
        parseXml(new TextDecoder().decode(part(f).data)).root,
      )) {
        const names = axis.children
            .filter(
              (n) => n.kind === "element" && n.name.namespaceURI === NS.chart,
            )
            .map((n) => n.name.localName),
          index = names.indexOf("tickLblPos");
        expect(index).toBeGreaterThan(-1);
        for (const n of ["majorTickMark", "minorTickMark", "numFmt"])
          if (names.includes(n)) expect(names.indexOf(n)).toBeLessThan(index);
        for (const n of ["spPr", "txPr", "crossAx"])
          if (names.includes(n))
            expect(names.indexOf(n)).toBeGreaterThan(index);
      }
    });
  it("does not create a secondary pair solely for secondary label settings", () => {
    const f = fixture({
        ...base(),
        series: [base().series[0]],
        ...requested(),
      }),
      ctx = chartPlotContext(
        parseXml(new TextDecoder().decode(part(f).data)).root,
      );
    expect(ctx.axes.axisForGroups(["catAx"], true)).toBeNull();
    expect(ctx.axes.axisForGroups(["valAx"], true)).toBeNull();
    expect(
      P.getShapeChartSpec(f.shape).secondaryValueAxisTickLabelPos,
    ).toBeUndefined();
  });
});
