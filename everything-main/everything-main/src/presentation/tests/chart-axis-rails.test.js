import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { chartAxisRailDeck, railColors } from "./chart-axis-rail-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  firstChildElement,
  serializeXml,
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const num = (e, n) => Number(attr(e, n));
const measure = (text, font) => ({
  widthPx: ([...text].length * font.sizePx) / 2,
  ascentPx: (font.sizePx * 3) / 4,
  descentPx: font.sizePx / 4,
  lineGapPx: 0,
});
function geometry(p, slide, kind) {
  const nodes = [];
  walkElements(
    parseXml(renderSlideToSvg(p, slide, { measureText: measure })).root,
    (e) => nodes.push(e),
  );
  const box = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  const coord = kind === "bar" ? "x" : "y";
  const origin = num(box, coord),
    end = origin + num(box, kind === "bar" ? "width" : "height");
  const roles = Object.fromEntries(
    Object.entries(railColors).map(([role, color]) => {
      const lines = nodes.filter(
        (e) => e.name.localName === "line" && attr(e, "stroke") === color,
      );
      const spine = lines.find(
        (e) =>
          Math.hypot(num(e, "x2") - num(e, "x1"), num(e, "y2") - num(e, "y1")) >
          10,
      );
      const ticks = lines.filter((e) => e !== spine);
      return [
        role,
        {
          spine: num(spine, coord + "1"),
          ticks: ticks.map((e) => [num(e, coord + "1"), num(e, coord + "2")]),
          labels: nodes.filter(
            (e) => e.name.localName === "text" && attr(e, "fill") === color,
          ),
        },
      ];
    }),
  );
  return { nodes, origin, end, roles };
}

describe("native axis rails in the renderer", () => {
  for (const kind of ["column", "bar"])
    for (const returned of [true, false]) {
      it(`${kind} ${returned ? "returned" : "shared outward"} rows retain separate marks, spines and labels after edits/copy/export`, async () => {
        const f = chartAxisRailDeck(kind, returned);
        const original = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice();
        const book = workbook(f.p, f.shape).data.slice();
        const check = (p, slide, edited = false) => {
          const r = geometry(p, slide, kind),
            bar = kind === "bar",
            side = bar ? -1 : 1;
          // Independent font-derived budgets: H=16, A/3=4; primary
          // distance 200 adds 4px, secondary distance 0 subtracts 4px.
          const primaryDepth = edited ? (bar ? 38 : 44) : bar ? 26 : 30;
          const secondaryDepth = bar ? 18 : 22;
          const low = bar ? r.origin : r.end,
            high = bar ? r.end : r.origin;
          for (const [role, offset] of [
            ["category", 0],
            ["secondaryCategory", primaryDepth],
          ]) {
            const a = r.roles[role];
            expect(a.labels).toHaveLength(4);
            expect(a.spine).toBeCloseTo(
              returned ? high : low + side * offset,
              1,
            );
            const rail = returned
              ? low +
                side *
                  (offset +
                    (role === "category" ? primaryDepth : secondaryDepth))
              : low + side * offset;
            expect(a.ticks).toHaveLength(5);
            a.ticks.forEach((t) =>
              expect(
                returned
                  ? bar
                    ? Math.min(...t)
                    : Math.max(...t)
                  : bar
                    ? Math.max(...t)
                    : Math.min(...t),
              ).toBeCloseTo(rail, 1),
            );
          }
          const chart = P.getSlideCharts(slide)[0];
          expect(chart.spec.series).toHaveLength(2);
          expect(P.validatePresentation(p)).toEqual([]);
          const view = chartRenderingView(chart.shape);
          expect(view.axisLines.secondaryCategory.geometry.labelOffset).toBe(0);
          expect(view.axisLines.category.geometry.position).toBe(
            bar ? "r" : "t",
          );
          expect(view.axisLines.secondaryCategory.geometry.position).toBe(
            bar ? "r" : "t",
          );
          return r;
        };
        const before = check(f.p, f.slide);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(original);
        const stage = createDeck("blank");
        const copy = P.importSlide(
          stage,
          f.slide,
          P.getSlideLayouts(stage)[0],
          { preservePaintFormatting: true, preserveTextFormatting: true },
        );
        check(stage, copy);
        const back = P.importSlide(f.p, copy, P.getSlideLayout(f.slide), {
          preservePaintFormatting: true,
          preserveTextFormatting: true,
        });
        const chart = P.getSlideCharts(back)[0];
        P.setChartSpec(chart, {
          ...chart.spec,
          categoryAxisLabelStyle: {
            ...chart.spec.categoryAxisLabelStyle,
            sizePt: 18,
          },
          series: chart.spec.series.map((s) => ({
            ...s,
            values: s.values.map((v) => v + 0.5),
          })),
        });
        check(f.p, back, true);
        const saved = await P.loadPresentation(await P.savePresentation(f.p));
        check(saved, P.getSlides(saved)[1], true);
        expect(geometry(saved, P.getSlides(saved)[0], kind)).toEqual(before);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(original);
        expect(workbook(f.p, f.shape).data).toEqual(book);
      });
    }
  it.each(["column", "bar"])(
    "keeps %s returned marks and stacked label anchors inside the chart",
    (kind) => {
      const f = chartAxisRailDeck(kind),
        r = geometry(f.p, f.slide, kind);
      const b = P.getShapeBoundsResolved(f.p, f.shape);
      const origin = (kind === "bar" ? b.x : b.y) / 9525;
      const end = origin + (kind === "bar" ? b.w : b.h) / 9525;
      for (const a of Object.values(r.roles)) {
        for (const tick of a.ticks)
          for (const v of tick) {
            expect(v).toBeGreaterThanOrEqual(origin - 0.01);
            expect(v).toBeLessThanOrEqual(end + 0.01);
          }
        for (const label of a.labels) {
          expect(num(label, kind === "bar" ? "x" : "y")).toBeGreaterThanOrEqual(
            origin,
          );
          expect(num(label, kind === "bar" ? "x" : "y")).toBeLessThanOrEqual(
            end,
          );
        }
      }
    },
  );
});

describe("native axis paragraph row inheritance", () => {
  it.each([
    ["omitted", "", "", "", null, 30],
    [
      "points below the font bounds",
      '<a:lnSpc><a:spcPts val="300"/></a:lnSpc>',
      "",
      "",
      { kind: "pts", value: 3 },
      18,
    ],
    [
      "percentage string",
      '<a:lnSpc><a:spcPct val="50%"/></a:lnSpc>',
      "",
      "",
      { kind: "pct", value: 0.5 },
      22,
    ],
    [
      "axis list level",
      "",
      '<a:lvl1pPr><a:lnSpc><a:spcPct val="75000"/></a:lnSpc></a:lvl1pPr>',
      "",
      { kind: "pct", value: 0.75 },
      26,
    ],
    [
      "parent chart paragraph",
      "",
      "",
      '<a:lnSpc><a:spcPct val="200000"/></a:lnSpc>',
      { kind: "pct", value: 2 },
      46,
    ],
    [
      "zero overrides inherited spacing",
      '<a:lnSpc><a:spcPts val="0"/></a:lnSpc>',
      "",
      '<a:lnSpc><a:spcPct val="200000"/></a:lnSpc>',
      { kind: "pts", value: 0 },
      14,
    ],
  ])("%s", (_, spacing, list, parent, expected, rowDepth) => {
    const f = chartAxisRailDeck("column", false);
    const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
    const doc = parseXml(new TextDecoder().decode(part.data));
    const child = (e, n, ns = NS.chart) =>
      firstChildElement(e, qname("", n, ns));
    const area = child(child(doc.root, "chart"), "plotArea");
    const axis = child(area, "catAx");
    const tx = child(axis, "txPr");
    const paragraph = child(child(tx, "p", NS.dml), "pPr", NS.dml);
    const xml = (s) =>
      parseXml(
        `<a:wrapper xmlns:a="${NS.dml}" xmlns:c="${NS.chart}">${s}</a:wrapper>`,
      ).root.children[0];
    if (spacing) paragraph.children.unshift(xml(spacing));
    if (list) child(tx, "lstStyle", NS.dml).children.push(xml(list));
    if (parent) {
      const existing = child(doc.root, "txPr");
      const replacement = xml(
        `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${parent}</a:pPr></a:p></c:txPr>`,
      );
      if (existing)
        doc.root.children[doc.root.children.indexOf(existing)] = replacement;
      else doc.root.children.push(replacement);
    }
    part.data = new TextEncoder().encode(serializeXml(doc));
    const bytes = part.data.slice(),
      book = workbook(f.p, f.shape).data.slice();
    expect(
      chartRenderingView(f.shape).axisLines.category.geometry.labelLineSpacing,
    ).toEqual(expected);
    const r = geometry(f.p, f.slide, "column");
    expect(
      r.roles.secondaryCategory.spine - r.roles.category.spine,
    ).toBeCloseTo(rowDepth, 1);
    expect(part.data).toEqual(bytes);
    expect(workbook(f.p, f.shape).data).toEqual(book);
  });
});

it("allocates native rows in plot-reference order when the model axis roles swap physical edges", () => {
  const f = chartAxisRailDeck();
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
  const doc = parseXml(new TextDecoder().decode(part.data));
  const context = chartPlotContext(doc.root),
    roles = chartAxisRoles(context.area, context.axes, false);
  const pos = (axis) => firstChildElement(axis, qname("", "axPos", NS.chart));
  pos(roles.value).attrs[0].value = "r";
  pos(roles.secondaryValue).attrs[0].value = "l";
  part.data = new TextEncoder().encode(serializeXml(doc));
  expect(P.getShapeChartSpec(f.shape).series[0].secondaryAxis).toBe(true);
  const view = chartRenderingView(f.shape);
  expect(view.axisLines.category.geometry.allocationOrder).toBe(1);
  expect(view.axisLines.secondaryCategory.geometry.allocationOrder).toBe(0);
  const r = geometry(f.p, f.slide, "column");
  expect(Math.max(...r.roles.category.ticks[0]) - r.end).toBeCloseTo(30, 1);
  expect(Math.max(...r.roles.secondaryCategory.ticks[0]) - r.end).toBeCloseTo(
    52,
    1,
  );
});

function paintedNodes(f) {
  const out = [];
  const visit = (e, tx = 0, ty = 0, scale = 1) => {
    let x = 0,
      y = 0,
      s = 1;
    for (const m of (attr(e, "transform") ?? "").matchAll(
      /(translate|scale)\(([^)]+)\)/g,
    )) {
      const v = m[2].trim().split(/[ ,]+/).map(Number);
      if (m[1] === "translate") {
        x += s * v[0];
        y += s * (v[1] ?? 0);
      } else s *= v[0];
    }
    tx += scale * x;
    ty += scale * y;
    scale *= s;
    out.push({
      e,
      x: tx + scale * num(e, "x"),
      y: ty + scale * num(e, "y"),
      w: scale * num(e, "width"),
      h: scale * num(e, "height"),
    });
    for (const c of e.children)
      if (c.kind === "element") visit(c, tx, ty, scale);
  };
  visit(
    parseXml(renderSlideToSvg(f.p, f.slide, { measureText: measure })).root,
  );
  return out;
}
for (const [kind, position] of [
  ["column", "b"],
  ["bar", "l"],
])
  it(`reserves ${kind} stacked rows beside the non-overlay ${position} legend`, () => {
    const f = chartAxisRailDeck(kind);
    const spec = P.getShapeChartSpec(f.shape);
    P.setChartSpec(
      { shape: f.shape, spec },
      {
        ...spec,
        legend: { position, fill: "#FAEDD6", textStyle: { sizePt: 12 } },
      },
    );
    const nodes = paintedNodes(f),
      legend = nodes.find(
        (n) => n.e.name.localName === "rect" && attr(n.e, "fill") === "#FAEDD6",
      );
    expect(legend).toBeDefined();
    const labels = nodes.filter(
      (n) =>
        n.e.name.localName === "text" &&
        Object.values(railColors).includes(attr(n.e, "fill")),
    );
    expect(labels).toHaveLength(8);
    for (const label of labels) {
      if (kind === "column") expect(label.y + 8).toBeLessThan(legend.y);
      else expect(label.x - 8).toBeGreaterThan(legend.x + legend.w);
    }
  });
it("reserves outward rows below the non-overlay chart title", () => {
  const f = chartAxisRailDeck("column", false),
    spec = P.getShapeChartSpec(f.shape);
  P.setChartSpec(
    { shape: f.shape, spec },
    {
      ...spec,
      title: "Heading",
      titleStyle: { sizePt: 24, color: "#751234" },
      valueAxisOrientation: "maxMin",
      secondaryValueAxisOrientation: "maxMin",
    },
  );
  const nodes = paintedNodes(f),
    title = nodes.find(
      (n) => n.e.name.localName === "text" && attr(n.e, "fill") === "#751234",
    );
  expect(title).toBeDefined();
  const labels = nodes.filter(
    (n) =>
      n.e.name.localName === "text" &&
      Object.values(railColors).includes(attr(n.e, "fill")),
  );
  for (const label of labels) expect(label.y - 8).toBeGreaterThan(title.y + 16);
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
