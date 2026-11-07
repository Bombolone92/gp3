// ChartSpec has no edit surface for native extension records. Keep them on
// surviving structural hosts instead of discarding them while writing caches.
import {
  NS,
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
  qname,
  withInheritedNamespaces,
} from "../xml/index.ts";
import {
  chartPlotContext,
  primaryChartAxis,
  readChartUnsignedInt,
} from "./axis-context.ts";

const c = (name: string) => qname("c", name, NS.chart),
  val = qname("", "val", ""),
  uri = qname("", "uri", "");

const merge = (
  source: XmlElement,
  target: XmlElement,
  sourcePath: XmlElement[],
  targetPath: XmlElement[],
) => {
  const native = firstChildElement(source, c("extLst"));
  if (!native) return;
  const generated = firstChildElement(target, c("extLst"));
  if (!generated) {
    // extLst is the final schema slot on the supported structural types.
    // Retain the complete list, not selected URIs.
    target.children.push(withInheritedNamespaces(native, sourcePath));
    return;
  }
  const authoredUris = new Set(
    allChildElements(generated, c("ext"))
      .map((entry) => getAttrValue(entry, uri))
      .filter((value) => value !== null),
  );
  const replacement = withInheritedNamespaces(
    {
      ...native,
      children: [
        ...native.children.filter((entry) => {
          if (
            entry.kind !== "element" ||
            entry.name.namespaceURI !== NS.chart ||
            entry.name.localName !== "ext"
          )
            return true;
          const recordUri = getAttrValue(entry, uri);
          return recordUri === null || !authoredUris.has(recordUri);
        }),
        ...generated.children.map((entry) =>
          entry.kind === "element"
            ? withInheritedNamespaces(entry, [...targetPath, generated])
            : entry,
        ),
      ],
    },
    sourcePath,
  );
  target.children = target.children.map((entry) =>
    entry === generated ? replacement : entry,
  );
};

// These singleton children have stable structural meaning. Cache/reference
// extensions require data-channel semantics and are deliberately not traversed.
const CHILDREN: Readonly<Record<string, ReadonlyArray<string>>> = {
  chartSpace: ["chart"],
  chart: ["title", "plotArea", "legend"],
  title: ["layout"],
  legend: ["layout"],
  catAx: ["scaling", "title"],
  dateAx: ["scaling", "title"],
  valAx: ["scaling", "title", "dispUnits"],
  dispUnits: ["dispUnitsLbl"],
  dispUnitsLbl: ["layout"],
  ser: ["marker", "dLbls", "trendline", "errBars"],
  barChart: ["dLbls"],
  lineChart: ["dLbls", "upDownBars"],
  areaChart: ["dLbls"],
  pieChart: ["dLbls"],
  doughnutChart: ["dLbls"],
  plotArea: ["layout", "dTable"],
  trendline: ["trendlineLbl"],
  trendlineLbl: ["layout"],
};
const index = (host: XmlElement) => {
  const idx = firstChildElement(host, c("idx"));
  return idx ? readChartUnsignedInt(getAttrValue(idx, val)) : null;
};
const mergeTree = (
  source: XmlElement,
  target: XmlElement,
  sourcePath: XmlElement[],
  targetPath: XmlElement[],
) => {
  if (
    source.name.namespaceURI !== target.name.namespaceURI ||
    source.name.localName !== target.name.localName
  )
    return;
  merge(source, target, sourcePath, targetPath);
  if (source.name.localName === "dLbls") {
    // ChartSpec does not expose data-label legend keys. Rebuilding series
    // must retain this native option rather than replace it with the
    // authoring default, independently of edits to represented label flags.
    const key = firstChildElement(source, c("showLegendKey"));
    if (key)
      target.children = target.children.map((node) =>
        node.kind === "element" &&
        node.name.namespaceURI === NS.chart &&
        node.name.localName === "showLegendKey"
          ? withInheritedNamespaces(key, sourcePath)
          : node,
      );
  }
  for (const name of CHILDREN[source.name.localName] ?? []) {
    const before = firstChildElement(source, c(name)),
      after = firstChildElement(target, c(name));
    if (before && after)
      mergeTree(before, after, [...sourcePath, before], [...targetPath, after]);
  }
  if (source.name.localName === "legend") {
    const entries = new Map<number, { items: XmlElement[]; next: number }>();
    for (const entry of allChildElements(source, c("legendEntry"))) {
      const idx = index(entry);
      if (idx !== null) {
        const group = entries.get(idx);
        if (group) group.items.push(entry);
        else entries.set(idx, { items: [entry], next: 0 });
      }
    }
    for (const entry of allChildElements(target, c("legendEntry"))) {
      const idx = index(entry),
        group = idx !== null ? entries.get(idx) : undefined,
        before = group && group.items[group.next++];
      if (before)
        mergeTree(
          before,
          entry,
          [...sourcePath, before],
          [...targetPath, entry],
        );
    }
  }
};

export const preserveNativeChartExtensions = (
  original: XmlElement,
  authored: XmlElement,
): void => {
  // Stable chart-space/chart hosts can still carry metadata when a damaged
  // plot is repaired from a complete supplied spec.
  mergeTree(original, authored, [original], [authored]);
  const source = chartPlotContext(original),
    target = chartPlotContext(authored);
  if (!source || !target) return;
  const native = source.groups.flatMap(({ element: group }) =>
    allChildElements(group, c("ser")).map((series) => ({ group, series })),
  );
  const associations = target.groups.map(({ element: group }) => {
    const owners = new Set(
      allChildElements(group, c("ser"))
        .map((series) => {
          const idx = index(series);
          return idx !== null ? native[idx]?.group : undefined;
        })
        .filter((owner) => owner !== undefined),
    );
    let before = owners.size === 1 ? [...owners][0] : undefined;
    // New series have no native owner; they must not erase an existing group's
    // identity. An empty group can also survive clearing/repopulating data when
    // its native type and primary/secondary axis association are unambiguous.
    if (owners.size === 0) {
      const candidates = source.groups.filter(
        ({ element }) =>
          element.name.localName === group.name.localName &&
          source.axes.groupUsesSecondaryAxis(element) ===
            target.axes.groupUsesSecondaryAxis(group),
      );
      if (candidates.length === 1) before = candidates[0]!.element;
    }
    return { group, before };
  });
  for (const { group, before } of associations)
    // Group extensions belong to a surviving one-to-one group, not to a newly
    // coalesced/split group with a different native membership or host type.
    if (
      before &&
      associations.filter((pair) => pair.before === before).length === 1
    )
      mergeTree(
        before,
        group,
        [original, source.chart, source.area, before],
        [authored, target.chart, target.area, group],
      );
  for (const names of [["catAx", "dateAx", "serAx"], ["valAx"]])
    for (const secondary of [false, true]) {
      const before = secondary
          ? source.axes.axisForGroups(names, true)
          : primaryChartAxis(source, names),
        after = target.axes.axisForGroups(names, secondary);
      if (before && after)
        mergeTree(
          before,
          after,
          [original, source.chart, source.area, before],
          [authored, target.chart, target.area, after],
        );
    }
  for (const { element: group } of target.groups)
    for (const series of allChildElements(group, c("ser"))) {
      const idx = firstChildElement(series, c("idx")),
        index = idx && readChartUnsignedInt(getAttrValue(idx, val)),
        before = index != null ? native[index] : undefined;
      // An extension is scoped to its host type. An explicitly converted
      // series cannot inherit unknown extensions for a different series type.
      if (!before || before.group.name.localName !== group.name.localName)
        continue;
      mergeTree(
        before.series,
        series,
        [original, source.chart, source.area, before.group, before.series],
        [authored, target.chart, target.area, group, series],
      );
    }
};
