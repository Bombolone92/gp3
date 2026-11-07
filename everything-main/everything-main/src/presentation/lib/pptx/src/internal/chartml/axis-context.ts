import { CHART_PLOT_KINDS } from "./plot-kinds.ts";
// Resolve axis roles from plot references and crossing relationships, never
// from XML order. Shared by model reading and native text-property edits.
import {
  NS,
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";
const NS_C = NS.chart;
const ATTR_VAL = qname("", "val", "");
// CT_TickMark defaults a present element's val to cross (ECMA-376
// 21.2.2.101/110). Preserve omission in the editable model; the native
// rendering view resolves the omitted-element default separately.
export const readChartTickMark = (
  element: XmlElement | null,
): "in" | "out" | "cross" | "none" | undefined => {
  if (!element) return undefined;
  const value = getAttrValue(element, ATTR_VAL);
  return value === null
    ? "cross"
    : value === "in" || value === "out" || value === "cross" || value === "none"
      ? value
      : undefined;
};
// OOXML unsignedInt metadata requires a complete integer, not a prefix.
// Shared by cache extents/indices and positive category-axis skip values.
export const readChartUnsignedInt = (raw: string | null): number | null => {
  if (raw === null || !/^[+-]?\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff
    ? value
    : null;
};

export const chartAxisContext = (
  plotArea: XmlElement,
  plotGroups: ReadonlyArray<{ readonly element: XmlElement }>,
) => {
  const readAxisId = (id: XmlElement | null): number | null =>
    id ? readChartUnsignedInt(getAttrValue(id, ATTR_VAL)) : null;
  const groupAxisIds = (group: XmlElement): number[] => {
    const ids: number[] = [];
    for (const idEl of allChildElements(group, qname("c", "axId", NS_C))) {
      const id = readAxisId(idEl);
      if (id !== null) ids.push(id);
    }
    return ids;
  };
  const valueAxes = allChildElements(plotArea, qname("c", "valAx", NS_C));
  const definedValueIds = new Set<number>();
  for (const axis of valueAxes) {
    const id = readAxisId(firstChildElement(axis, qname("c", "axId", NS_C)));
    if (id !== null) definedValueIds.add(id);
  }
  // Distinct plot references identify value-axis systems. Multiple groups
  // sharing a pair, including one XY pair, still identify just one system.
  const valueSystems = new Set<string>();
  for (const group of plotGroups) {
    const ids = groupAxisIds(group.element).filter((id) =>
      definedValueIds.has(id),
    );
    if (ids.length > 0)
      valueSystems.add([...new Set(ids)].sort((a, b) => a - b).join(","));
  }
  const axesById = new Map<number, XmlElement>();
  for (const axis of plotArea.children) {
    if (
      axis.kind !== "element" ||
      axis.name.namespaceURI !== NS_C ||
      !["catAx", "dateAx", "serAx", "valAx"].includes(axis.name.localName)
    )
      continue;
    const id = readAxisId(firstChildElement(axis, qname("c", "axId", NS_C)));
    if (id !== null) axesById.set(id, axis);
  }
  // A resolved crossing relationship remains authored even without series
  // on its value axis. Crossings need not be reciprocal: two value axes may
  // share a category axis. Unresolved unused axes do not form another system.
  const crossingAxes = new Map<XmlElement, XmlElement>();
  for (const axis of valueAxes) {
    const id = readAxisId(firstChildElement(axis, qname("c", "axId", NS_C))),
      cross = readAxisId(firstChildElement(axis, qname("c", "crossAx", NS_C))),
      other = cross !== null ? axesById.get(cross) : undefined;
    if (id === null || cross === null || id === cross || !other) continue;
    const values = [id, cross].filter((n) => definedValueIds.has(n));
    valueSystems.add(
      values
        .slice()
        .sort((a, b) => a - b)
        .join(","),
    );
    crossingAxes.set(axis, other);
  }
  // Within the supported two-pair model, right/top value axes identify the
  // secondary system only when separate coordinate systems are authored.
  const secondaryValAxisIds = new Set<number>();
  for (const axis of valueAxes) {
    const axId = readAxisId(firstChildElement(axis, qname("c", "axId", NS_C)));
    const axPosEl = firstChildElement(axis, qname("c", "axPos", NS_C));
    const axPos = axPosEl !== null ? getAttrValue(axPosEl, ATTR_VAL) : null;
    if (
      valueSystems.size > 1 &&
      axId !== null &&
      (axPos === "r" || axPos === "t")
    )
      secondaryValAxisIds.add(axId);
  }
  // Crossing choices can put both systems on the same physical edge. axPos
  // then cannot identify primary/secondary: treating all right/top axes as
  // secondary (or all left/bottom axes as primary) collapses independent data.
  // Keep the conventional opposite-edge assignment when it is unambiguous.
  // Otherwise the first referenced system defines the model's primary role;
  // axis XML order and unrelated unreferenced axes do not change the binding.
  const referencedValues = new Set<number>();
  for (const group of plotGroups)
    for (const id of groupAxisIds(group.element))
      if (definedValueIds.has(id)) referencedValues.add(id);
  const referencedSecondary = [...referencedValues].filter((id) =>
    secondaryValAxisIds.has(id),
  );
  if (
    valueSystems.size > 1 &&
    referencedValues.size > 1 &&
    (referencedSecondary.length === 0 ||
      referencedSecondary.length === referencedValues.size)
  ) {
    const primary = new Set(
      plotGroups
        .map((group) =>
          groupAxisIds(group.element).filter((id) => definedValueIds.has(id)),
        )
        .find((ids) => ids.length > 0),
    );
    for (const id of referencedValues) {
      if (primary.has(id)) secondaryValAxisIds.delete(id);
      else secondaryValAxisIds.add(id);
    }
  }
  const primaryAxes = new Set<XmlElement>();
  for (const [axis, other] of crossingAxes) {
    const id = readAxisId(firstChildElement(axis, qname("c", "axId", NS_C))),
      cross = readAxisId(firstChildElement(other, qname("c", "axId", NS_C)));
    if (id !== null && !secondaryValAxisIds.has(id)) {
      primaryAxes.add(axis);
      if (cross !== null && !secondaryValAxisIds.has(cross))
        primaryAxes.add(other);
    }
  }
  const groupUsesSecondaryAxis = (group: XmlElement): boolean =>
    groupAxisIds(group).some((id) => secondaryValAxisIds.has(id));

  // Axis order in XML is not the association: plot groups name their axes
  // by axId. Resolve category and value metadata from the same axis pair.
  const axisForGroups = (
    names: ReadonlyArray<string>,
    secondary: boolean,
    matches: (axis: XmlElement) => boolean = () => true,
  ): XmlElement | null => {
    const ids = new Set<number>();
    for (const group of plotGroups) {
      if (groupUsesSecondaryAxis(group.element) !== secondary) continue;
      for (const id of groupAxisIds(group.element)) ids.add(id);
    }
    for (const axis of plotArea.children) {
      if (
        axis.kind !== "element" ||
        axis.name.namespaceURI !== NS_C ||
        !names.includes(axis.name.localName) ||
        !matches(axis)
      )
        continue;
      const idEl = firstChildElement(axis, qname("c", "axId", NS_C));
      const id = readAxisId(idEl);
      if (id !== null && ids.has(id)) return axis;
    }
    // Preserve the unused primary pair when all plotted groups are secondary.
    if (!secondary) {
      for (const axis of primaryAxes)
        if (names.includes(axis.name.localName) && matches(axis)) return axis;
    }
    return null;
  };

  return { readAxisId, groupAxisIds, groupUsesSecondaryAxis, axisForGroups };
};

const c = (name: string) => qname("c", name, NS_C);
export const chartPlotContext = (root: XmlElement) => {
  const chart = firstChildElement(root, c("chart"));
  const area = chart && firstChildElement(chart, c("plotArea"));
  if (!chart || !area) return null;
  const groups = area.children
    .filter(
      (n): n is XmlElement =>
        n.kind === "element" &&
        n.name.namespaceURI === NS.chart &&
        CHART_PLOT_KINDS.some((k) => k.localName === n.name.localName),
    )
    .map((element) => ({ element }));
  return { chart, area, groups, axes: chartAxisContext(area, groups) };
};

export const primaryChartAxis = (
  context: NonNullable<ReturnType<typeof chartPlotContext>>,
  names: ReadonlyArray<string>,
) =>
  context.axes.axisForGroups(names, false) ??
  context.area.children.find(
    (e): e is XmlElement =>
      e.kind === "element" &&
      e.name.namespaceURI === NS.chart &&
      names.includes(e.name.localName),
  ) ??
  null;

/** Model fields and rendering metadata must select the same native axis. */
export const chartAxisRoles = (
  area: XmlElement,
  axes: Pick<ReturnType<typeof chartAxisContext>, "axisForGroups">,
  numericXY: boolean,
) => {
  const { axisForGroups } = axes;
  const position = (axis: XmlElement) => {
    const pos = firstChildElement(axis, c("axPos"));
    return pos && getAttrValue(pos, ATTR_VAL);
  };
  const horizontal = (axis: XmlElement) =>
      ["b", "t"].includes(position(axis) ?? ""),
    vertical = (axis: XmlElement) => ["l", "r"].includes(position(axis) ?? "");
  const first = (names: string[]) =>
    area.children.find(
      (e): e is XmlElement =>
        e.kind === "element" &&
        e.name.namespaceURI === NS_C &&
        names.includes(e.name.localName),
    ) ?? null;
  return {
    value:
      (numericXY ? axisForGroups(["valAx"], false, vertical) : null) ??
      axisForGroups(["valAx"], false) ??
      first(["valAx"]),
    category:
      (numericXY ? axisForGroups(["valAx"], false, horizontal) : null) ??
      axisForGroups(["catAx", "dateAx", "serAx"], false) ??
      first(["catAx", "dateAx", "serAx"]),
    secondaryValue:
      (numericXY ? axisForGroups(["valAx"], true, vertical) : null) ??
      axisForGroups(["valAx"], true),
    secondaryCategory: numericXY
      ? axisForGroups(["valAx"], true, horizontal)
      : axisForGroups(["catAx", "dateAx", "serAx"], true),
  };
};
