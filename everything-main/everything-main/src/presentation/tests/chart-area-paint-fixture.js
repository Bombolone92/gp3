import { P } from "../src/model.js";
import { chartLegendOrderDeck, chartRoot } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.dml) => firstChildElement(e, qname("", n, ns));
const node = (s) =>
  parseXml(
    `<a:wrapper xmlns:a="${NS.dml}" xmlns:c="${NS.chart}">${s}</a:wrapper>`,
  ).root.children[0];
export const areaGradient =
  '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="60000"/><a:alpha val="75000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="40000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>';
export const areaImage = `<a:blipFill><a:blip xmlns:r="${NS.officeDocRels}" r:embed="ownImage"><a:alphaModFix amt="60000"/></a:blip><a:srcRect l="12500"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
export const areaImageBytes = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAHElEQVQI12MU8676z4AEjmTvQ+YyMDEQAJQrAADMhQPPU4lX0gAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
export const areaPattern =
  '<a:pattFill prst="diagCross"><a:fgClr><a:schemeClr val="phClr"><a:alpha val="60000"/></a:schemeClr></a:fgClr><a:bgClr><a:srgbClr val="F0C390"><a:alpha val="30000"/></a:srgbClr></a:bgClr></a:pattFill>';

// Own native paint declarations, unrelated colors, scoped whole-scheme overrides.
export function chartAreaPaintDeck({
  style,
  variant,
  fill,
  plotFill,
  line,
  plotLine,
  themeLine,
  themeFill,
  themeOwner = "chart",
  ...spec
} = {}) {
  const f = chartLegendOrderDeck({
      kind: "column",
      chartStyle: style,
      chartStyleVariant: variant,
      legend: undefined,
      ...(["pie", "doughnut"].includes(spec.kind)
        ? { series: [{ name: "Values", values: [2, 4], color: "#E85239" }] }
        : {}),
      ...spec,
    }),
    pkg = P._internalPackageOf(f.p),
    part = pkg.getPart(chartRoot(f.shape));
  if (fill || plotFill || line || plotLine) {
    const doc = parseXml(new TextDecoder().decode(part.data));
    if (fill || line)
      doc.root.children.push(
        node(`<c:spPr>${fill ?? ""}${line ?? ""}</c:spPr>`),
      );
    if (plotFill || plotLine)
      child(
        child(doc.root, "chart", NS.chart),
        "plotArea",
        NS.chart,
      ).children.push(
        node(`<c:spPr>${plotFill ?? ""}${plotLine ?? ""}</c:spPr>`),
      );
    part.data = new TextEncoder().encode(serializeXml(doc));
  }
  if (themeFill || themeLine) {
    const base = pkg.parts.find(
        (p) =>
          p.contentType ===
          "application/vnd.openxmlformats-officedocument.theme+xml",
      ),
      t = parseXml(new TextDecoder().decode(base.data)),
      els = child(t.root, "themeElements"),
      colors = structuredClone(child(els, "clrScheme")),
      fmt = structuredClone(child(els, "fmtScheme"));
    child(colors, "lt1").children = [node('<a:srgbClr val="B4E57D"/>')];
    child(colors, "dk1").children = [node('<a:srgbClr val="182D73"/>')];
    if (themeFill)
      child(fmt, "fillStyleLst").children = [
        node(themeFill),
        ...child(fmt, "fillStyleLst").children.slice(1),
      ];
    if (themeLine)
      child(fmt, "lnStyleLst").children = [
        node(themeLine),
        ...child(fmt, "lnStyleLst").children.slice(1),
      ];
    const doc = node("<a:themeOverride/>");
    doc.children = [colors, fmt];
    const name = "/ppt/theme/own-chart-paint.xml";
    pkg.addPart(
      name,
      "application/vnd.openxmlformats-officedocument.themeOverride+xml",
      new TextEncoder().encode(
        serializeXml({ root: doc, prolog: [], epilog: [] }),
      ),
    );
    const owner =
        themeOwner === "slide"
          ? P.getSlidePartName(f.slide)
          : themeOwner === "layout"
            ? P.getSlideLayoutPartName(P.getSlideLayout(f.slide))
            : part.name,
      rels = pkg.getRels(owner);
    rels.items.push({
      id: "ownChartPaint",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride",
      target: name,
      targetMode: "Internal",
    });
    pkg.setRels(owner, rels);
  }
  for (const [paint, owner] of [
    [fill, part.name],
    [plotFill, part.name],
    [themeFill, "/ppt/theme/own-chart-paint.xml"],
  ]) {
    if (!paint?.includes("ownImage")) continue;
    const image = "/ppt/media/own-chart-area.png";
    if (!pkg.getPart(image))
      pkg.addPart(image, "image/png", areaImageBytes.slice());
    const rels = pkg.getRels(owner) ?? { items: [] };
    if (!rels.items.some((r) => r.id === "ownImage"))
      rels.items.push({
        id: "ownImage",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        target: image,
        targetMode: "Internal",
      });
    pkg.setRels(owner, rels);
  }
  P.setSlideBackground(f.slide, "#C593DB");
  return f;
}

export const chartLineTheme =
  '<a:ln w="57150" cap="rnd" cmpd="sng"><a:solidFill><a:schemeClr val="phClr"><a:shade val="70000"/><a:alpha val="60000"/></a:schemeClr></a:solidFill><a:prstDash val="sysDot"/><a:bevel/></a:ln>';
