import type { PartName } from "../../internal/opc/index.ts";
import { resolveTarget } from "../../internal/opc/index.ts";
import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
import {
  NS,
  type XmlElement,
  elem,
  firstChildElement,
  qname,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  SLIDE_PART_NAME,
  LAYOUT_PART_NAME,
  type SlideData,
} from "../_internal-symbols.ts";
import { themeForSlide } from "./shape-theme.ts";
import { themeFromRoot, fontsFromThemeRoot } from "./theme.ts";
import { getSlideLayout } from "./shape-slide-read.ts";
import { getEffectiveColorMap } from "./color-map.ts";
const THEME_OVERRIDE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride";
export const schemes = ["clrScheme", "fontScheme", "fmtScheme"] as const;
export type Scheme = (typeof schemes)[number];
export type ThemeBlock = { element: XmlElement; owner: PartName };
const child = (root: XmlElement, name: string) =>
  firstChildElement(root, qname("a", name, NS.dml));

// Native overrides replace whole schemes, in layout → slide → chart order.
// Retain each block's owner so its image relationship IDs remain meaningful.
export const themeBlocks = (slide: SlideData, chart: PartName) => {
  const pkg = slide[INTERNAL_PACKAGE],
    blocks = new Map<Scheme, ThemeBlock>();
  const base = themeForSlide(slide);
  const add = (root: XmlElement, owner: PartName) => {
    for (const name of schemes) {
      const element = child(root, name);
      if (element) blocks.set(name, { element, owner });
    }
  };
  if (base) {
    const elements = child(base.root, "themeElements");
    if (elements) add(elements, base.partName);
  }
  const layout = getSlideLayout(slide);
  const owners = [
    ...(layout ? [layout[LAYOUT_PART_NAME]] : []),
    slide[SLIDE_PART_NAME],
    chart,
  ];
  for (const owner of owners) {
    const rel = pkg
      .getRels(owner)
      ?.items.find(
        (r) => r.type === THEME_OVERRIDE && r.targetMode === "Internal",
      );
    const part = rel && pkg.getPart(resolveTarget(owner, rel.target));
    if (!part) continue;
    let root: XmlElement;
    try {
      root = readOnlyPartRoot(part);
    } catch {
      continue;
    } // Malformed optional overrides remain opaque; retain the inherited theme.
    if (
      root.name.namespaceURI === NS.dml &&
      root.name.localName === "themeOverride"
    )
      add(root, part.name);
  }
  return blocks;
};

/** @internal The chart's own native override participates in preview palette resolution. */
export const themeForChartPart = (slide: SlideData, chart: PartName) => {
  const blocks = themeBlocks(slide, chart);
  const root = elem(qname("a", "theme", NS.dml), {
    children: [
      elem(qname("a", "themeElements", NS.dml), {
        children: [...blocks.values()].map((b) => b.element),
      }),
    ],
  });
  return { theme: themeFromRoot(root), fonts: fontsFromThemeRoot(root) };
};

/** ChartML uses the host application's mapping unless c:clrMapOvr overrides it.
 * Only unqualified mapping attributes participate; extension attributes stay opaque. */
export const colorMapForChart = (slide: SlideData, root: XmlElement) => {
  const mapping = getEffectiveColorMap(slide);
  const override = firstChildElement(root, qname("c", "clrMapOvr", NS.chart));
  for (const a of override?.attrs ?? [])
    if (a.name.namespaceURI === "" && Object.hasOwn(mapping, a.name.localName))
      mapping[a.name.localName] = a.value;
  return mapping;
};
