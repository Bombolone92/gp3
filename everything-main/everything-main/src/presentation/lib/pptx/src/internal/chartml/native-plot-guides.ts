import {
  NS,
  type XmlElement,
  type XmlNode,
  allChildElements,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
  withInheritedNamespaces,
} from "../xml/index.ts";
import { chartPlotContext, readChartUnsignedInt } from "./axis-context.ts";
import type { ChartSpec } from "./types.ts";

const c = (name: string) => qname("c", name, NS.chart);
const child = (e: XmlElement, name: string) => firstChildElement(e, c(name));
const value = (e: XmlElement | null) =>
  e && getAttrValue(e, qname("", "val", ""));
const is = (e: XmlElement, name: string) =>
  e.name.namespaceURI === NS.chart && e.name.localName === name;
const family = (group: XmlElement) => {
  switch (group.name.localName) {
    case "lineChart":
    case "line3DChart":
    case "stockChart":
      return "line";
    case "areaChart":
    case "area3DChart":
      return "area";
    default:
      return undefined;
  }
};
const guides = ["dropLines", "hiLowLines"] as const;

/** Guides belong to a plot group, not to the whole chart (CT_ChartLines).
 * ChartSpec's legacy flags describe only the first native plot. An unrelated
 * edit must preserve other groups' independent presence, paint, and extensions.
 * Generated series idx is the model position; native idx/order need not be.
 */
export const preserveNativeChartPlotGuides = (
  original: XmlElement,
  authored: XmlElement,
  spec: ChartSpec,
): void => {
  const source = chartPlotContext(original),
    target = chartPlotContext(authored),
    first = source?.groups[0]?.element;
  if (!source || !target || !first) return;
  const native = source.groups.flatMap(({ element }) =>
      allChildElements(element, c("ser")).map(() => element),
    ),
    sourceSystems = new Map(
      source.groups.map(({ element }) => [
        element,
        source.axes.groupUsesSecondaryAxis(element),
      ]),
    );
  const previousFlags = {
    dropLines: child(first, "dropLines") ? true : undefined,
    hiLowLines: child(first, "hiLowLines") ? true : undefined,
  };
  const sameHost = (
    before: XmlElement,
    after: XmlElement,
    secondary: boolean,
  ) =>
    family(before) === family(after) && sourceSystems.get(before) === secondary;
  const previousGrouping = value(child(first, "grouping"));
  const groupingUnchanged =
    spec.grouping ===
    (["clustered", "standard", "stacked", "percentStacked"].includes(
      previousGrouping ?? "",
    )
      ? previousGrouping
      : undefined);
  const replacements = new Map<XmlElement, XmlElement[]>();
  for (const { element: group } of target.groups) {
    if (!family(group)) continue;
    const secondary = target.axes.groupUsesSecondaryAxis(group);
    // The writer coalesces equal kind/axis groups. Restore their membership
    // before attaching native guides, so independent styles never leak across
    // series. New/converted/reassigned series keep their generated defaults.
    const partitions = new Map<XmlElement | undefined, XmlElement[]>();
    for (const series of allChildElements(group, c("ser"))) {
      const idx = readChartUnsignedInt(value(child(series, "idx"))),
        before = idx === null ? undefined : native[idx],
        owner =
          before && sameHost(before, group, secondary) ? before : undefined,
        members = partitions.get(owner);
      if (members) members.push(series);
      else partitions.set(owner, [series]);
    }
    if (partitions.size === 0) {
      const candidates = source.groups.filter(({ element }) =>
        sameHost(element, group, secondary),
      );
      partitions.set(
        candidates.length === 1 ? candidates[0]!.element : undefined,
        [],
      );
    }
    // A group without any native guides needs no membership restoration for
    // this feature. Avoid changing unrelated native plot structure.
    if (
      ![...partitions.keys()].some(
        (owner) => owner && guides.some((name) => child(owner, name)),
      ) &&
      !guides.some((name) => child(group, name))
    )
      continue;
    const rebuilt: XmlElement[] = [],
      firstSeries = group.children.findIndex(
        (node) => node.kind === "element" && is(node, "ser"),
      ),
      template = group.children.filter(
        (node) => node.kind !== "element" || !is(node, "ser"),
      );
    for (const [owner, members] of partitions) {
      // Singleton options may receive independent native extensions below.
      // Series belong to exactly one partition; retain their rebuilt caches
      // without allocating another copy of potentially large point arrays.
      const options = template.map((node) => structuredClone(node)),
        at = firstSeries < 0 ? options.length : firstSeries;
      const result: XmlElement = {
        ...group,
        children: [...options.slice(0, at), ...members, ...options.slice(at)],
      };
      if (owner && groupingUnchanged) {
        const grouping = child(owner, "grouping"),
          token = value(grouping);
        // ST_Grouping differs from ST_BarGrouping: clustered is not valid on
        // line/area plots. Keep the writer's repair for malformed declarations.
        if (
          grouping &&
          (token === null ||
            ["standard", "stacked", "percentStacked"].includes(token))
        )
          result.children = result.children.map((node) =>
            node.kind === "element" && is(node, "grouping")
              ? withInheritedNamespaces(grouping, [
                  original,
                  source.chart,
                  source.area,
                  owner,
                ])
              : node,
          );
      }
      for (const name of guides) {
        const supported = name === "dropLines" || family(group) === "line",
          previous = previousFlags[name],
          changed = spec[name] !== previous,
          retained = owner && supported ? child(owner, name) : null;
        result.children = result.children.filter(
          (node) => node.kind !== "element" || !is(node, name),
        );
        const enabled = changed
          ? spec[name]
          : owner
            ? !!retained
            : !!child(group, name);
        if (!supported || !enabled) continue;
        // Guides follow dLbls, before upDownBars/marker/smooth/axis references.
        const at = result.children.findIndex(
          (node) =>
            node.kind === "element" &&
            node.name.namespaceURI === NS.chart &&
            (name === "dropLines"
              ? [
                  "hiLowLines",
                  "upDownBars",
                  "marker",
                  "smooth",
                  "axId",
                  "extLst",
                ]
              : ["upDownBars", "marker", "smooth", "axId", "extLst"]
            ).includes(node.name.localName),
        );
        const guide = retained
          ? withInheritedNamespaces(retained, [
              original,
              source.chart,
              source.area,
              owner!,
            ])
          : elem(c(name));
        result.children.splice(at < 0 ? result.children.length : at, 0, guide);
      }
      rebuilt.push(result);
    }
    replacements.set(group, rebuilt);
  }
  target.area.children = target.area.children.flatMap<XmlNode>((node) =>
    node.kind === "element" ? (replacements.get(node) ?? [node]) : [node],
  );
};
