import { P } from "../src/model.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { chartAxisLineDeck } from "./chart-axis-line-fixture.js";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import {
  NS,
  parseXml,
  serializeXml,
  qname,
  firstChildElement,
} from "../lib/pptx/src/internal/xml/index.ts";

// Native declarations not represented by the editable ChartSpec (secondary
// scales and XY x scaling). Resolve roles through plot/crossing references.
export function chartAxisGridDeck({ axes = {}, ...options } = {}) {
  return setChartAxisGridDeclarations(
    chartAxisLineDeck(options),
    axes,
    options.kind === "scatter" || options.kind === "bubble",
  );
}
export function setChartAxisGridDeclarations(f, axes, numericXY = false) {
  f.part ??= P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    context = chartPlotContext(doc.root),
    roles = chartAxisRoles(context.area, context.axes, numericXY);
  const child = (e, n) => firstChildElement(e, qname("", n, NS.chart));
  const node = (xml) =>
    parseXml(
      `<c:wrapper xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${xml}</c:wrapper>`,
    ).root.children[0];
  const order = [
    "axId",
    "scaling",
    "delete",
    "axPos",
    "majorGridlines",
    "minorGridlines",
    "title",
    "numFmt",
    "majorTickMark",
    "minorTickMark",
    "tickLblPos",
    "spPr",
    "txPr",
    "crossAx",
    "crosses",
    "crossesAt",
    "crossBetween",
    "majorUnit",
    "minorUnit",
    "tickLblSkip",
    "tickMarkSkip",
  ];
  const set = (host, name, xml) => {
    host.children = host.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.chart ||
        e.name.localName !== name,
    );
    if (!xml) return;
    const at = host.children.findIndex(
      (e) =>
        e.kind === "element" &&
        e.name.namespaceURI === NS.chart &&
        order.indexOf(e.name.localName) > order.indexOf(name),
    );
    host.children.splice(at < 0 ? host.children.length : at, 0, node(xml));
  };
  for (const [role, cfg] of Object.entries(axes)) {
    const axis = roles[role];
    if (!axis) throw Error(`Missing native ${role} axis`);
    if (cfg.hidden !== undefined)
      set(axis, "delete", `<c:delete val="${cfg.hidden ? 1 : 0}"/>`);
    for (const prop of [
      "majorUnit",
      "minorUnit",
      "majorTickMark",
      "minorTickMark",
      "tickMarkSkip",
    ])
      if (cfg[prop] !== undefined)
        set(
          axis,
          prop,
          cfg[prop] === null ? null : `<c:${prop} val="${cfg[prop]}"/>`,
        );
    for (const prop of ["major", "minor"])
      if (cfg[prop] !== undefined)
        set(
          axis,
          prop + "Gridlines",
          cfg[prop] === false
            ? null
            : `<c:${prop}Gridlines>${cfg[prop] === true ? "" : `<c:spPr>${cfg[prop]}</c:spPr>`}</c:${prop}Gridlines>`,
        );
    for (const prop of ["min", "max"])
      if (cfg[prop] !== undefined)
        set(child(axis, "scaling"), prop, `<c:${prop} val="${cfg[prop]}"/>`);
  }
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
