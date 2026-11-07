// ChartSpec exposes a small uniform text style. Editing those fields must not
// reconstruct the rest of a native DrawingML text body (or freeze its theme
// references into RGB). Apply only the represented field changes to its native
// defaults/runs; retain body, paragraphs, script fonts and extension markup.
import {
  NS,
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
  elem,
  qname,
  withInheritedNamespaces,
} from "../xml/index.ts";
import {
  chartPlotContext as plot,
  primaryChartAxis as primaryAxis,
} from "./axis-context.ts";
import type { ChartSpec, ChartTextStyle } from "./types.ts";
import { readChartTextStyle, type ChartColorResolver } from "./chart-reader.ts";
import { CHART_AUTO_ROTATION } from "./text-rotation.ts";

export interface ChartNativeTextState {
  readonly textStyle?: ChartTextStyle | undefined;
  readonly legend?:
    { readonly textStyle?: ChartTextStyle | undefined } | undefined;
  readonly categoryAxisLabelStyle?: ChartTextStyle | undefined;
  readonly valueAxisLabelStyle?: ChartTextStyle | undefined;
  readonly categoryAxisLabelRotationDeg?: number | null | undefined;
  readonly valueAxisLabelRotationDeg?: number | null | undefined;
  readonly dataLabels?:
    { readonly textStyle?: ChartTextStyle | undefined } | undefined;
  readonly series: ReadonlyArray<{
    readonly dataLabels?:
      { readonly textStyle?: ChartTextStyle | undefined } | undefined;
  }>;
}

const a = (name: string) => qname("a", name, NS.dml);
const c = (name: string) => qname("c", name, NS.chart);
const isA = (e: XmlElement, names: ReadonlyArray<string>) =>
  e.name.namespaceURI === NS.dml && names.includes(e.name.localName);
const STYLE_FIELDS = ["font", "sizePt", "bold", "italic", "color"] as const;
const FILL_NAMES = [
  "noFill",
  "solidFill",
  "gradFill",
  "blipFill",
  "pattFill",
  "grpFill",
];
const RUN_CHILD_ORDER = [
  "ln",
  ...FILL_NAMES,
  "effectLst",
  "effectDag",
  "highlight",
  "uLnTx",
  "uLn",
  "uFillTx",
  "uFill",
  "latin",
  "ea",
  "cs",
  "sym",
  "hlinkClick",
  "hlinkMouseOver",
  "rtl",
  "extLst",
];

// Insert optional DrawingML children in their schema slot without rearranging
// unrelated native children, including opaque extension payloads.
const insertRunChild = (parent: XmlElement, child: XmlElement): void => {
  const order = RUN_CHILD_ORDER.indexOf(child.name.localName);
  const next = parent.children.findIndex(
    (n) =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.dml &&
      RUN_CHILD_ORDER.indexOf(n.name.localName) > order,
  );
  parent.children.splice(next < 0 ? parent.children.length : next, 0, child);
};

const updateText = (
  source: XmlElement,
  authored: XmlElement | null,
  previous: ChartTextStyle | undefined,
  next: ChartTextStyle | undefined,
  previousRotation?: number | null,
  nextRotation?: number | null,
): XmlElement => {
  const changed = STYLE_FIELDS.filter((k) => previous?.[k] !== next?.[k]);
  const rotationChanged = previousRotation !== nextRotation;
  if (!changed.length && !rotationChanged) return source;
  const authoredP = authored && firstChildElement(authored, a("p"));
  const authoredPPr = authoredP && firstChildElement(authoredP, a("pPr"));
  const authoredRun =
    authoredPPr && firstChildElement(authoredPPr, a("defRPr"));
  const patchRun = (run: XmlElement): XmlElement => {
    const result = {
      ...run,
      attrs: [...run.attrs],
      children: [...run.children],
    };
    for (const [field, name] of [
      ["sizePt", "sz"],
      ["bold", "b"],
      ["italic", "i"],
    ] as const) {
      if (!changed.includes(field)) continue;
      result.attrs = result.attrs.filter(
        (at) => at.name.namespaceURI !== "" || at.name.localName !== name,
      );
      const replacement = authoredRun?.attrs.find(
        (at) => at.name.namespaceURI === "" && at.name.localName === name,
      );
      if (replacement) result.attrs.push(replacement);
    }
    if (changed.includes("color")) {
      result.children = result.children.filter(
        (n) => n.kind !== "element" || !isA(n, FILL_NAMES),
      );
      const replacement =
        authoredRun && firstChildElement(authoredRun, a("solidFill"));
      if (replacement) insertRunChild(result, replacement);
    }
    if (changed.includes("font"))
      for (const name of ["latin", "ea"]) {
        const replacement =
          authoredRun && firstChildElement(authoredRun, a(name));
        const existing = firstChildElement(result, a(name));
        if (!replacement)
          result.children = result.children.filter((n) => n !== existing);
        else if (existing)
          result.children = result.children.map((n) =>
            n === existing
              ? {
                  ...existing,
                  attrs: [
                    ...existing.attrs.filter(
                      (at) =>
                        at.name.namespaceURI !== "" ||
                        at.name.localName !== "typeface",
                    ),
                    ...replacement.attrs,
                  ],
                }
              : n,
          );
        else insertRunChild(result, replacement);
      }
    return result;
  };
  const hasNewFormatting = changed.some((k) => next?.[k] !== undefined);
  return {
    ...source,
    children: source.children.map((node) => {
      if (node.kind !== "element" || node.name.namespaceURI !== NS.dml)
        return node;
      if (node.name.localName === "bodyPr" && rotationChanged) {
        const rotation =
          authored &&
          firstChildElement(authored, a("bodyPr"))?.attrs.find(
            (at) => at.name.namespaceURI === "" && at.name.localName === "rot",
          );
        return {
          ...node,
          attrs: [
            ...node.attrs.filter(
              (at) =>
                at.name.namespaceURI !== "" || at.name.localName !== "rot",
            ),
            ...(rotation ? [rotation] : []),
          ],
        };
      }
      if (node.name.localName !== "p" || !changed.length) return node;
      const oldPPr = firstChildElement(node, a("pPr"));
      let children = node.children.map((child) => {
        if (child.kind !== "element" || child.name.namespaceURI !== NS.dml)
          return child;
        if (child.name.localName === "pPr") {
          const existing = firstChildElement(child, a("defRPr"));
          const result = {
            ...child,
            children: child.children.map((n) =>
              n === existing && existing ? patchRun(existing) : n,
            ),
          };
          if (!existing && hasNewFormatting) {
            const extension = result.children.findIndex(
              (n) => n.kind === "element" && isA(n, ["extLst"]),
            );
            result.children.splice(
              extension < 0 ? result.children.length : extension,
              0,
              patchRun(elem(a("defRPr"))),
            );
          }
          return result;
        }
        if (child.name.localName === "endParaRPr") return patchRun(child);
        if (["r", "fld", "br"].includes(child.name.localName))
          return {
            ...child,
            children: child.children.map((n) =>
              n.kind === "element" && isA(n, ["rPr"]) ? patchRun(n) : n,
            ),
          };
        return child;
      });
      if (!oldPPr && hasNewFormatting)
        children = [
          elem(a("pPr"), { children: [patchRun(elem(a("defRPr")))] }),
          ...children,
        ];
      return { ...node, children };
    }),
  };
};

/** Read only the represented text fields; never materialize chart data caches. */
export const readNativeChartTextState = (
  root: XmlElement,
  resolveColor: ChartColorResolver,
): ChartNativeTextState | null => {
  const context = plot(root);
  if (!context) return null;
  const style = (host: XmlElement | null) => {
    const txPr = host && firstChildElement(host, c("txPr"));
    return txPr ? readChartTextStyle(txPr, resolveColor) : undefined;
  };
  const rotation = (host: XmlElement | null) => {
    const txPr = host && firstChildElement(host, c("txPr")),
      bodyPr = txPr && firstChildElement(txPr, a("bodyPr"));
    const raw = bodyPr && getAttrValue(bodyPr, qname("", "rot", ""));
    if (raw == null) return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n)
      ? n === CHART_AUTO_ROTATION
        ? null
        : n / 60000
      : undefined;
  };
  const category = primaryAxis(context, ["catAx", "dateAx", "serAx"]),
    value = primaryAxis(context, ["valAx"]);
  const legend = firstChildElement(context.chart, c("legend")),
    labels =
      context.groups[0] &&
      firstChildElement(context.groups[0].element, c("dLbls"));
  return {
    textStyle: style(root),
    legend: legend ? { textStyle: style(legend) } : undefined,
    categoryAxisLabelStyle: style(category),
    valueAxisLabelStyle: style(value),
    categoryAxisLabelRotationDeg: rotation(category),
    valueAxisLabelRotationDeg: rotation(value),
    dataLabels: labels ? { textStyle: style(labels) } : undefined,
    series: context.groups.flatMap((g) =>
      allChildElements(g.element, c("ser")).map((ser) => {
        const labels = firstChildElement(ser, c("dLbls"));
        return {
          dataLabels: labels ? { textStyle: style(labels) } : undefined,
        };
      }),
    ),
  };
};

/** Preserve native c:txPr slots while applying ChartSpec text field deltas. */
export const preserveNativeChartText = (
  original: XmlElement,
  authored: XmlElement,
  previous: ChartNativeTextState,
  next: ChartSpec,
): void => {
  const source = plot(original),
    target = plot(authored);
  if (!source || !target) return;
  const merge = (
    from: XmlElement | null,
    to: XmlElement | null,
    ancestors: XmlElement[],
    before?: ChartTextStyle,
    after?: ChartTextStyle,
    beforeRotation?: number | null,
    afterRotation?: number | null,
  ) => {
    if (!from || !to) return;
    const native = firstChildElement(from, c("txPr"));
    if (!native) return;
    const generated = firstChildElement(to, c("txPr"));
    const replacement = withInheritedNamespaces(
      updateText(
        native,
        generated,
        before,
        after,
        beforeRotation,
        afterRotation,
      ),
      ancestors,
    );
    if (generated)
      to.children = to.children.map((n) => (n === generated ? replacement : n));
    else {
      // All these CT_* parents place txPr immediately before their remaining
      // options/extensions (or externalData at chartSpace level).
      const following = [
        "crossAx",
        "dLblPos",
        "showLegendKey",
        "showVal",
        "showCatName",
        "showSerName",
        "showPercent",
        "showBubbleSize",
        "separator",
        "showLeaderLines",
        "externalData",
        "printSettings",
        "userShapes",
        "extLst",
      ];
      const index = to.children.findIndex(
        (n) =>
          n.kind === "element" &&
          n.name.namespaceURI === NS.chart &&
          following.includes(n.name.localName),
      );
      to.children.splice(
        index < 0 ? to.children.length : index,
        0,
        replacement,
      );
    }
  };
  merge(original, authored, [original], previous.textStyle, next.textStyle);
  merge(
    firstChildElement(source.chart, c("legend")),
    firstChildElement(target.chart, c("legend")),
    [original, source.chart, firstChildElement(source.chart, c("legend"))!],
    previous.legend?.textStyle,
    next.legend?.textStyle,
  );
  for (const [names, styleField, rotationField] of [
    [
      ["catAx", "dateAx", "serAx"],
      "categoryAxisLabelStyle",
      "categoryAxisLabelRotationDeg",
    ],
    [["valAx"], "valueAxisLabelStyle", "valueAxisLabelRotationDeg"],
  ] as const) {
    const from = primaryAxis(source, names);
    const to = target.axes.axisForGroups(names, false);
    if (from)
      merge(
        from,
        to,
        [original, source.chart, source.area, from],
        previous[styleField],
        next[styleField],
        previous[rotationField],
        next[rotationField],
      );
    const secondary = source.axes.axisForGroups(names, true);
    if (secondary)
      merge(secondary, target.axes.axisForGroups(names, true), [
        original,
        source.chart,
        source.area,
        secondary,
      ]);
  }
  // Plot-default label styles are uniform in ChartSpec; per-series slots are
  // associated in the same traversal order used by readChartSpec/the builder.
  const sourceSeries = source.groups.flatMap((g) =>
    allChildElements(g.element, c("ser")).map((ser) => ({
      group: g.element,
      ser,
    })),
  );
  const targetSeries = new Map(
    target.groups
      .flatMap((g) => allChildElements(g.element, c("ser")))
      .map((ser) => [
        Number(
          getAttrValue(firstChildElement(ser, c("idx"))!, qname("", "val", "")),
        ),
        ser,
      ]),
  );
  for (const [i, entry] of sourceSeries.entries()) {
    const to = targetSeries.get(i);
    const fromLabels = firstChildElement(entry.ser, c("dLbls"));
    const toLabels = to && firstChildElement(to, c("dLbls"));
    if (fromLabels)
      merge(
        fromLabels,
        toLabels ?? null,
        [
          original,
          source.chart,
          source.area,
          entry.group,
          entry.ser,
          fromLabels,
        ],
        previous.series[i]?.dataLabels?.textStyle,
        next.series[i]?.dataLabels?.textStyle,
      );
  }
  const groupKind = (group: XmlElement) => {
    if (group.name.localName !== "barChart") return group.name.localName;
    const direction = firstChildElement(group, c("barDir"));
    const bar =
      direction && getAttrValue(direction, qname("", "val", "")) === "bar";
    return `${group.name.localName}:${bar ? "bar" : "col"}`;
  };
  for (const group of target.groups) {
    const from =
      source.groups.find(
        (g) =>
          groupKind(g.element) === groupKind(group.element) &&
          source.axes.groupUsesSecondaryAxis(g.element) ===
            target.axes.groupUsesSecondaryAxis(group.element),
      ) ?? source.groups[0];
    const labels = from && firstChildElement(from.element, c("dLbls"));
    if (labels)
      merge(
        labels,
        firstChildElement(group.element, c("dLbls")),
        [original, source.chart, source.area, from.element, labels],
        previous.dataLabels?.textStyle,
        next.dataLabels?.textStyle,
      );
  }
};
