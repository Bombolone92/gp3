// Apply represented paint deltas to native DrawingML shape properties instead
// of rebuilding their fill/outline/effect bodies during a chart data edit.
import {
  NS,
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
  qname,
  elem,
  withInheritedNamespaces,
} from "../xml/index.ts";
import {
  chartPlotContext,
  primaryChartAxis,
  readChartUnsignedInt,
} from "./axis-context.ts";
import {
  readChartPaint,
  readChartSolidPaint,
  readBoolean,
  type ChartColorResolver,
} from "./chart-reader.ts";
import { readChartStrokeWidth } from "./stroke-width.ts";
import type { ChartSpec, ChartSeries } from "./types.ts";
import { invertedSolidFillHost, invertedSolidFillRecord } from "./inversion.ts";

const a = (name: string) => qname("a", name, NS.dml);
const c = (name: string) => qname("c", name, NS.chart);
const val = qname("", "val", "");
const FILL = [
  "noFill",
  "solidFill",
  "gradFill",
  "blipFill",
  "pattFill",
  "grpFill",
];
const DASH = ["prstDash", "custDash"];
const isA = (e: XmlElement, names: ReadonlyArray<string>) =>
  e.name.namespaceURI === NS.dml && names.includes(e.name.localName);
const fillNode = (parent: XmlElement | null) =>
  parent?.children.find(
    (n): n is XmlElement => n.kind === "element" && isA(n, FILL),
  );

type PaintState = {
  fill?: string | null | undefined;
  stroke?: string | null | undefined;
  width?: number | undefined;
  dash?: string | undefined;
};
const readPaintState = (
  host: XmlElement,
  resolve: ChartColorResolver,
  solidOnly = false,
): PaintState => {
  const sp = firstChildElement(host, c("spPr")),
    ln = sp && firstChildElement(sp, a("ln")),
    dash = ln && firstChildElement(ln, a("prstDash"));
  return {
    fill: sp
      ? solidOnly
        ? readChartSolidPaint(sp, resolve)
        : readChartPaint(sp, resolve)
      : undefined,
    stroke: ln ? readChartPaint(ln, resolve) : undefined,
    width: readChartStrokeWidth(host),
    dash: dash ? (getAttrValue(dash, val) ?? undefined) : undefined,
  };
};

const changeChoice = (
  node: XmlElement,
  names: ReadonlyArray<string>,
  replacement: XmlElement | undefined,
  following: ReadonlyArray<string>,
) => {
  const children = node.children.filter(
    (n) => n.kind !== "element" || !isA(n, names),
  );
  if (replacement) {
    const at = children.findIndex(
      (n) => n.kind === "element" && isA(n, following),
    );
    children.splice(at < 0 ? children.length : at, 0, replacement);
  }
  return { ...node, children };
};

const updatePaint = (
  native: XmlElement,
  authored: XmlElement | null,
  before: PaintState,
  next: PaintState,
): XmlElement => {
  let result = native;
  if (Object.hasOwn(next, "fill") && before.fill !== next.fill)
    result = changeChoice(result, FILL, fillNode(authored), [
      "ln",
      "effectLst",
      "effectDag",
      "scene3d",
      "sp3d",
      "extLst",
    ]);
  const strokeChanged =
      Object.hasOwn(next, "stroke") && before.stroke !== next.stroke,
    widthChanged = Object.hasOwn(next, "width") && before.width !== next.width,
    dashChanged = Object.hasOwn(next, "dash") && before.dash !== next.dash;
  if (!strokeChanged && !widthChanged && !dashChanged) return result;
  const originalLine = firstChildElement(result, a("ln")),
    authoredLine = authored && firstChildElement(authored, a("ln"));
  let line = originalLine ?? elem(a("ln"));
  if (strokeChanged)
    line = changeChoice(line, FILL, fillNode(authoredLine), [
      ...DASH,
      "round",
      "bevel",
      "miter",
      "headEnd",
      "tailEnd",
      "extLst",
    ]);
  if (widthChanged) {
    const replacement = authoredLine?.attrs.find(
      (at) => at.name.namespaceURI === "" && at.name.localName === "w",
    );
    line = {
      ...line,
      attrs: [
        ...line.attrs.filter(
          (at) => at.name.namespaceURI !== "" || at.name.localName !== "w",
        ),
        ...(replacement ? [replacement] : []),
      ],
    };
  }
  if (dashChanged)
    line = changeChoice(
      line,
      DASH,
      authoredLine?.children.find(
        (n): n is XmlElement => n.kind === "element" && isA(n, DASH),
      ),
      ["round", "bevel", "miter", "headEnd", "tailEnd", "extLst"],
    );
  if (originalLine)
    return {
      ...result,
      children: result.children.map((n) => (n === originalLine ? line : n)),
    };
  if (!line.attrs.length && !line.children.length) return result;
  return changeChoice(result, ["ln"], line, [
    "effectLst",
    "effectDag",
    "scene3d",
    "sp3d",
    "extLst",
  ]);
};

// Each host uses its own schema slot; retaining a body never revives a removed
// legend, gridline, axis, marker, trendline or title host.
const insertSpPr = (host: XmlElement, replacement: XmlElement) => {
  const following =
    host.name.localName === "ser"
      ? [
          "invertIfNegative",
          "pictureOptions",
          "marker",
          "dPt",
          "dLbls",
          "trendline",
          "errBars",
          "cat",
          "val",
          "smooth",
          "extLst",
        ]
      : host.name.localName === "dPt"
        ? ["pictureOptions", "extLst"]
        : host.name.localName === "trendline"
          ? [
              "trendlineType",
              "period",
              "order",
              "intercept",
              "forward",
              "backward",
              "dispRSqr",
              "dispEq",
              "trendlineLbl",
              "extLst",
            ]
          : ["dLbls", "dLbl"].includes(host.name.localName)
            ? [
                "txPr",
                "dLblPos",
                "showLegendKey",
                "showVal",
                "showCatName",
                "showSerName",
                "showPercent",
                "showBubbleSize",
                "separator",
                "showLeaderLines",
                "leaderLines",
                "extLst",
              ]
            : [
                "txPr",
                "crossAx",
                "externalData",
                "printSettings",
                "userShapes",
                "extLst",
              ];
  const at = host.children.findIndex(
    (n) =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.chart &&
      following.includes(n.name.localName),
  );
  host.children.splice(at < 0 ? host.children.length : at, 0, replacement);
};

/** Keep native shape-property bodies and edit only represented paint fields. */
export const preserveNativeChartPaint = (
  original: XmlElement,
  authored: XmlElement,
  next: ChartSpec,
  resolve: ChartColorResolver,
): void => {
  const source = chartPlotContext(original),
    target = chartPlotContext(authored);
  if (!source || !target) return;
  const merge = (
    from: XmlElement | null,
    to: XmlElement | null,
    ancestors: XmlElement[],
    fields?: PaintState,
    solidOnly = false,
    beforeOverride?: PaintState,
  ) => {
    if (!from || !to) return;
    const native = firstChildElement(from, c("spPr"));
    if (!native) return;
    const generated = firstChildElement(to, c("spPr"));
    const replacement = withInheritedNamespaces(
      fields
        ? updatePaint(
            native,
            generated,
            beforeOverride ?? readPaintState(from, resolve, solidOnly),
            fields,
          )
        : native,
      ancestors,
    );
    if (generated)
      to.children = to.children.map((n) => (n === generated ? replacement : n));
    else insertSpPr(to, replacement);
  };
  merge(original, authored, [original], {
    fill: next.chartAreaFill,
    stroke: next.chartAreaStrokeColor,
    width: next.chartAreaStrokeWidthEmu,
  });
  merge(source.area, target.area, [original, source.chart, source.area], {
    fill: next.plotAreaFill,
    stroke: next.plotAreaStrokeColor,
    width: next.plotAreaStrokeWidthEmu,
  });
  const legend = firstChildElement(source.chart, c("legend"));
  if (legend)
    merge(
      legend,
      firstChildElement(target.chart, c("legend")),
      [original, source.chart, legend],
      {
        fill: next.legend?.fill,
        stroke: next.legend?.strokeColor,
        width: next.legend?.strokeWidthEmu,
      },
    );
  const chartTitle = firstChildElement(source.chart, c("title"));
  if (chartTitle)
    merge(chartTitle, firstChildElement(target.chart, c("title")), [
      original,
      source.chart,
      chartTitle,
    ]);
  for (const [names, prefix] of [
    [["catAx", "dateAx", "serAx"], "categoryAxis"],
    [["valAx"], "valueAxis"],
  ] as const)
    for (const secondary of [false, true]) {
      const from = secondary
          ? source.axes.axisForGroups(names, true)
          : primaryChartAxis(source, names),
        to = target.axes.axisForGroups(names, secondary);
      if (!from || !to) continue;
      const path = [original, source.chart, source.area, from];
      const stroke = secondary
        ? prefix === "categoryAxis"
          ? next.secondaryCategoryAxisLineColor
          : next.secondaryValueAxisLineColor
        : next[`${prefix}LineColor`];
      const width = secondary
        ? prefix === "categoryAxis"
          ? next.secondaryCategoryAxisLineWidthEmu
          : next.secondaryValueAxisLineWidthEmu
        : next[`${prefix}LineWidthEmu`];
      // Axis fill and other outline properties have no represented field.
      merge(from, to, path, {
        ...readPaintState(from, resolve),
        stroke,
        width,
      });
      for (const level of ["Major", "Minor"] as const) {
        const local = level === "Major" ? "majorGridlines" : "minorGridlines",
          grid = firstChildElement(from, c(local));
        if (grid)
          merge(
            grid,
            firstChildElement(to, c(local)),
            [...path, grid],
            secondary
              ? undefined
              : {
                  ...readPaintState(grid, resolve),
                  stroke: next[`${prefix}${level}GridlineColor`],
                  width: next[`${prefix}${level}GridlineWidthEmu`],
                },
          );
      }
      const title = firstChildElement(from, c("title"));
      if (title)
        merge(title, firstChildElement(to, c("title")), [...path, title]);
    }
  const sourceSeries = source.groups.flatMap((g) =>
      allChildElements(g.element, c("ser")).map((ser) => ({
        group: g.element,
        ser,
      })),
    ),
    targetSeries = new Map(
      target.groups
        .flatMap((g) => allChildElements(g.element, c("ser")))
        .map((ser) => [
          Number(getAttrValue(firstChildElement(ser, c("idx"))!, val)),
          ser,
        ]),
    );
  for (const [i, entry] of sourceSeries.entries()) {
    const to = targetSeries.get(i),
      spec = next.series[i];
    if (!to || !spec) continue;
    const path = [original, source.chart, source.area, entry.group, entry.ser];
    merge(
      entry.ser,
      to,
      path,
      {
        fill: spec.color,
        stroke: spec.lineColor,
        width: spec.lineWidthEmu,
        dash: spec.lineDash,
      },
      true,
    );
    const marker = firstChildElement(entry.ser, c("marker"));
    if (marker)
      merge(marker, firstChildElement(to, c("marker")), [...path, marker], {
        fill: spec.markerFill,
        stroke: spec.markerStrokeColor,
        width: spec.markerStrokeWidthEmu,
      });
    const trendline = firstChildElement(entry.ser, c("trendline"));
    if (trendline) {
      const nativeSp = firstChildElement(trendline, c("spPr")),
        nativeLine = nativeSp && firstChildElement(nativeSp, a("ln")),
        state = readPaintState(trendline, resolve);
      // Trendline.color models only solid paint. Native noFill/other choices
      // remain opaque unless an explicit color override replaces them.
      const previousSolid = nativeLine
        ? readChartSolidPaint(nativeLine, resolve)
        : undefined;
      merge(
        trendline,
        firstChildElement(to, c("trendline")),
        [...path, trendline],
        {
          ...state,
          stroke:
            previousSolid === undefined && spec.trendline?.color === undefined
              ? state.stroke
              : spec.trendline?.color,
        },
      );
    }
    const labels = firstChildElement(entry.ser, c("dLbls"));
    if (labels)
      merge(labels, firstChildElement(to, c("dLbls")), [...path, labels]);
    preservePoints(entry.ser, to, path, spec, resolve, merge);
  }
  for (const group of target.groups) {
    // Plot-level data-label paints are unrepresented. Associate native groups
    // through their surviving series rather than depending on group XML order.
    const first = firstChildElement(group.element, c("ser")),
      id =
        first && Number(getAttrValue(firstChildElement(first, c("idx"))!, val));
    const sourceGroup = id != null ? sourceSeries[id]?.group : undefined;
    const labels = sourceGroup && firstChildElement(sourceGroup, c("dLbls"));
    if (sourceGroup && labels)
      merge(labels, firstChildElement(group.element, c("dLbls")), [
        original,
        source.chart,
        source.area,
        sourceGroup,
        labels,
      ]);
  }
};

type Merge = (
  from: XmlElement | null,
  to: XmlElement | null,
  ancestors: XmlElement[],
  fields?: PaintState,
  solidOnly?: boolean,
  beforeOverride?: PaintState,
) => void;
const preservePoints = (
  from: XmlElement,
  to: XmlElement,
  path: XmlElement[],
  spec: ChartSeries,
  resolve: ChartColorResolver,
  merge: Merge,
) => {
  const native = allChildElements(from, c("dPt"));
  if (!native.length) return;
  const index = (point: XmlElement) => {
    const idx = firstChildElement(point, c("idx"));
    return idx ? readChartUnsignedInt(getAttrValue(idx, val)) : null;
  };
  const generated = allChildElements(to, c("dPt")),
    byIndex = new Map(generated.map((point) => [index(point), point])),
    seen = new Set<number>(),
    colors = new Map<number, string>(),
    explosions = new Map<number, number>(),
    inversions = new Map<number, boolean>();
  // The reader exposes the last recognized override for each index. Compare
  // against that effective value so an unchanged field keeps every native
  // duplicate, including earlier inactive choices and unrepresented paints.
  for (const point of native) {
    const idx = index(point);
    if (idx === null) continue;
    const color = readPaintState(point, resolve, true).fill,
      explosion = firstChildElement(point, c("explosion")),
      parsed = explosion
        ? readChartUnsignedInt(getAttrValue(explosion, val))
        : null;
    if (typeof color === "string") colors.set(idx, color);
    if (parsed !== null && parsed > 0) explosions.set(idx, parsed);
    const inversion = readBoolean(
      firstChildElement(point, c("invertIfNegative")),
    );
    if (inversion !== undefined) inversions.set(idx, inversion);
  }
  const points = native.map((point) => {
    const idx = index(point);
    if (idx === null) return withInheritedNamespaces(point, path);
    seen.add(idx);
    const newPoint = byIndex.get(idx),
      copy = { ...point, children: [...point.children] },
      explosion = firstChildElement(point, c("explosion")),
      next = spec.pointExplosions?.[idx] ?? undefined;
    if (
      inversions.get(idx) !== (spec.pointInvertIfNegative?.[idx] ?? undefined)
    ) {
      copy.children = copy.children.filter(
        (n) =>
          n.kind !== "element" ||
          n.name.namespaceURI !== NS.chart ||
          n.name.localName !== "invertIfNegative",
      );
      const replacement =
        newPoint && firstChildElement(newPoint, c("invertIfNegative"));
      if (replacement) {
        const at = copy.children.findIndex(
          (n) =>
            n.kind === "element" &&
            n.name.namespaceURI === NS.chart &&
            n.name.localName !== "idx",
        );
        copy.children.splice(
          at < 0 ? copy.children.length : at,
          0,
          replacement,
        );
      }
    }
    if (explosions.get(idx) !== next) {
      copy.children = copy.children.filter((n) => n !== explosion);
      const replacement =
        newPoint && firstChildElement(newPoint, c("explosion"));
      if (replacement) {
        const at = copy.children.findIndex(
          (n) =>
            n.kind === "element" &&
            n.name.namespaceURI === NS.chart &&
            ["spPr", "pictureOptions", "extLst"].includes(n.name.localName),
        );
        copy.children.splice(
          at < 0 ? copy.children.length : at,
          0,
          replacement,
        );
      }
    }
    const state = readPaintState(point, resolve, true),
      color = spec.pointColors?.[idx] ?? undefined;
    // Use a temporary host to provide only the newly authored paint choice;
    // native point outlines/effects/options retain their independent semantics.
    const paintTarget = {
      ...copy,
      children: copy.children.filter(
        (n) =>
          n.kind !== "element" ||
          n.name.namespaceURI !== NS.chart ||
          n.name.localName !== "spPr",
      ),
    };
    const newSp = newPoint && firstChildElement(newPoint, c("spPr"));
    if (newSp) paintTarget.children.push(newSp);
    merge(
      point,
      paintTarget,
      [...path, point],
      { ...state, fill: color },
      true,
      { ...state, fill: colors.get(idx) },
    );
    return withInheritedNamespaces(paintTarget, path);
  });
  for (const point of generated)
    if (!seen.has(index(point)!)) points.push(point);
  const at = to.children.findIndex(
    (n) =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.chart &&
      [
        "dPt",
        "dLbls",
        "trendline",
        "errBars",
        "cat",
        "val",
        "smooth",
        "extLst",
      ].includes(n.name.localName),
  );
  to.children = to.children.filter(
    (n) =>
      n.kind !== "element" ||
      n.name.namespaceURI !== NS.chart ||
      n.name.localName !== "dPt",
  );
  to.children.splice(at < 0 ? to.children.length : at, 0, ...points);
};

/** Apply the represented inverted solid color after opaque extensions merge.
 * Retain native theme choices and other extension properties for data-only
 * edits; changing/clearing the color must not revive an old extension. */
export const preserveNativeChartInversion = (
  original: XmlElement,
  authored: XmlElement,
  next: ChartSpec,
  resolve: ChartColorResolver,
): void => {
  const source = chartPlotContext(original),
    target = chartPlotContext(authored);
  if (!source || !target) return;
  const native = source.groups.flatMap(({ element }) =>
    allChildElements(element, c("ser")).map((ser) => ({ group: element, ser })),
  );
  for (const { element: group } of target.groups) {
    if (group.name.localName !== "barChart") continue;
    for (const ser of allChildElements(group, c("ser"))) {
      const index = firstChildElement(ser, c("idx"));
      const id = index && readChartUnsignedInt(getAttrValue(index, val));
      const before = id != null ? native[id] : undefined;
      const spec = id != null ? next.series[id] : undefined;
      if (
        !before ||
        !spec ||
        before.group.name.localName !== group.name.localName
      )
        continue;
      const record = invertedSolidFillRecord(before.ser);
      const host = invertedSolidFillHost(before.ser);
      if (!record || !host) continue;
      const previous = readChartSolidPaint(host, resolve);
      const generated = invertedSolidFillRecord(ser);
      const list = firstChildElement(ser, c("extLst"));
      if (!list) continue;
      let replacement: XmlElement | undefined;
      if (previous === spec.negativeColor) {
        replacement = record;
      } else if (spec.negativeColor !== undefined && generated) {
        const generatedHost = invertedSolidFillHost(ser);
        const fill =
          generatedHost && firstChildElement(generatedHost, a("solidFill"));
        if (fill) {
          const updated = changeChoice(host, FILL, fill, [
            "ln",
            "effectLst",
            "effectDag",
            "scene3d",
            "sp3d",
            "extLst",
          ]);
          const replace = (e: XmlElement): XmlElement =>
            e === host
              ? updated
              : {
                  ...e,
                  children: e.children.map((n) =>
                    n.kind === "element" ? replace(n) : n,
                  ),
                };
          replacement = replace(record);
        }
      }
      const path = [
        original,
        source.chart,
        source.area,
        before.group,
        before.ser,
        firstChildElement(before.ser, c("extLst"))!,
      ];
      list.children = list.children.flatMap((n) =>
        n === generated
          ? replacement
            ? [withInheritedNamespaces(replacement, path)]
            : []
          : [n],
      );
    }
  }
};
