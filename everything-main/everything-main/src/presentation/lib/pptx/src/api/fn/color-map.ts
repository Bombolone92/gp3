import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
// Effective color-map resolution.
//
// Every `schemeClr` token (`tx1`, `bg1`, `accent1`, …) is resolved
// through the slide's effective color map before indexing the theme. The map
// comes from the slide master's `<p:clrMap>`, optionally overridden on layouts
// and slides by `<p:clrMapOvr><a:overrideClrMapping>`. Most decks use the
// standard map
// (`bg1="lt1" tx1="dk1"`), but exports from Google Slides / Canva frequently
// INVERT it (`bg1="dk1" tx1="lt1"`). Resolving colors without the map then
// paints text and backgrounds with swapped light/dark colors — the bug this
// module exists to prevent.

import {
  type PartName,
  partName,
  resolveTarget,
} from "../../internal/opc/index.ts";
import type { OpcPackage } from "../../internal/parts/index.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  qname,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  LAYOUT_PART,
  LAYOUT_PART_NAME,
  type PresentationData,
  type SlideLayoutData,
  SLIDE_DOCUMENT,
  SLIDE_PART_NAME,
  type SlideData,
} from "../_internal-symbols.ts";
import { resolveDrawingColor, resolveSchemeToken } from "./shape-color.ts";
import { getSlideLayout } from "./shape-slide-read.ts";
import { themeForSlide } from "./shape-theme.ts";

// The standard `<p:clrMap>` — the fallback for the rare deck that omits the
// element entirely. `bg1`/`tx1`/`bg2`/`tx2` point at the matching theme slots;
// accents and hyperlinks are identity.
const STANDARD_COLOR_MAP: Readonly<Record<string, string>> = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

const NAME_CLR_MAP = qname("p", "clrMap", NS.pml);
const NAME_CLR_MAP_OVR = qname("p", "clrMapOvr", NS.pml);
const NAME_OVERRIDE = qname("a", "overrideClrMapping", NS.dml);
const NAME_TX_STYLES = qname("p", "txStyles", NS.pml);
const NAME_BODY_STYLE = qname("p", "bodyStyle", NS.pml);
const NAME_LVL1_PPR = qname("a", "lvl1pPr", NS.dml);
const NAME_DEF_RPR = qname("a", "defRPr", NS.dml);
const NAME_SOLID_FILL = qname("a", "solidFill", NS.dml);

// Resolve relationships on every read, so rebinding a layout/master takes
// effect immediately. Cache only the read-only master XML, keyed by part
// identity and bytes; replacing a part or its data invalidates that view.
const getSlideMasterRoot = (slide: SlideData): XmlElement | null => {
  // Decoration handles can refer directly to a layout or master part.
  const ownRoot = slide[SLIDE_DOCUMENT].root;
  if (ownRoot.name.localName === "sldMaster") return ownRoot;
  const pkg = slide[INTERNAL_PACKAGE];
  const slideRels = pkg.getRels(slide[SLIDE_PART_NAME]);
  if (slideRels === null) return null;
  const layoutRel = slideRels.items.find(
    (r) => r.type === REL_TYPES.slideLayout,
  );
  if (!layoutRel && ownRoot.name.localName !== "sldLayout") return null;
  const layoutPartName = layoutRel
    ? layoutRel.target.startsWith("/")
      ? partName(layoutRel.target)
      : resolveTarget(slide[SLIDE_PART_NAME], layoutRel.target)
    : slide[SLIDE_PART_NAME];
  return getMasterRoot(pkg, layoutPartName);
};

const getMasterRoot = (
  pkg: OpcPackage,
  layoutPartName: PartName,
): XmlElement | null => {
  const layoutRels = pkg.getRels(layoutPartName);
  if (layoutRels === null) return null;
  const masterRel = layoutRels.items.find(
    (r) => r.type === REL_TYPES.slideMaster,
  );
  if (!masterRel) return null;
  const masterPartName = masterRel.target.startsWith("/")
    ? partName(masterRel.target)
    : resolveTarget(layoutPartName, masterRel.target);
  const masterPart = pkg.getPart(masterPartName);
  if (masterPart === null) return null;
  return readOnlyPartRoot(masterPart);
};

const readMap = (clrMap: XmlElement | null): Record<string, string> | null => {
  if (!clrMap) return null;
  const out: Record<string, string> = {};
  for (const a of clrMap.attrs) {
    if (
      a.name.namespaceURI !== "" ||
      !Object.hasOwn(STANDARD_COLOR_MAP, a.name.localName)
    )
      continue;
    out[a.name.localName] = a.value;
  }
  return Object.keys(out).length > 0 ? out : null;
};

const readOverride = (root: XmlElement): Record<string, string> | null => {
  const override = firstChildElement(root, NAME_CLR_MAP_OVR);
  return override ? readMap(firstChildElement(override, NAME_OVERRIDE)) : null;
};

// Internal companions for readers whose handles refer to a template part.
export const getMasterColorMap = (
  root: XmlElement | null,
): Record<string, string> => ({
  ...STANDARD_COLOR_MAP,
  ...(root ? readMap(firstChildElement(root, NAME_CLR_MAP)) : null),
});

export const getLayoutColorMap = (
  pres: PresentationData,
  layout: SlideLayoutData,
): Record<string, string> => ({
  ...getMasterColorMap(
    getMasterRoot(pres[INTERNAL_PACKAGE], layout[LAYOUT_PART_NAME]),
  ),
  ...readOverride(layout[LAYOUT_PART].root),
});

/**
 * The slide's effective color map: master, then layout, then slide overrides.
 * An absent override or `masterClrMapping` inherits the parent mapping;
 * the parent of a slide is its layout, whose parent is the slide master.
 * Falls back to the standard map for decks that omit it.
 *
 * Pass the result to color resolution / renderers so `schemeClr` tokens map to
 * the theme slot that is actually painted — critical for decks with an
 * inverted map (`bg1="dk1" tx1="lt1"`).
 */
export const getEffectiveColorMap = (
  slide: SlideData,
): Record<string, string> => {
  const ownRoot = slide[SLIDE_DOCUMENT].root;
  const masterRoot = getSlideMasterRoot(slide);
  const layoutRoot =
    ownRoot.name.localName === "sldLayout"
      ? ownRoot
      : ownRoot.name.localName === "sld"
        ? getSlideLayout(slide)?.[LAYOUT_PART].root
        : undefined;
  return {
    ...getMasterColorMap(masterRoot),
    ...(layoutRoot ? readOverride(layoutRoot) : null),
    ...readOverride(ownRoot),
  };
};

// First DrawingML color child of a `<a:solidFill>` element.
const firstColorChild = (solidFill: XmlElement): XmlElement | null => {
  for (const c of solidFill.children) {
    if (c.kind === "element" && c.name.namespaceURI === NS.dml) return c;
  }
  return null;
};

/**
 * The concrete `#RRGGBB` color the deck paints body text in, resolved through
 * the effective color map + theme. Read from the master's `bodyStyle` level-1
 * default run properties; falls back to the `tx1` token resolved through the
 * map. Returns `null` only when the deck carries no theme.
 *
 * Tables and charts authored by this library inherit no master text style, so
 * their text otherwise falls back to `tx1` — which an inverted color map paints
 * the SAME as the background, making the text invisible. Baking the body color
 * in keeps generated tables / charts readable on whatever surface the deck uses.
 */
export const resolveDeckBodyTextColor = (slide: SlideData): string | null => {
  const theme = themeForSlide(slide)?.theme;
  if (!theme) return null;
  const clrMap = getEffectiveColorMap(slide);
  const masterRoot = getSlideMasterRoot(slide);
  if (masterRoot) {
    const txStyles = firstChildElement(masterRoot, NAME_TX_STYLES);
    const bodyStyle = txStyles
      ? firstChildElement(txStyles, NAME_BODY_STYLE)
      : null;
    const lvl1 = bodyStyle ? firstChildElement(bodyStyle, NAME_LVL1_PPR) : null;
    const defRPr = lvl1 ? firstChildElement(lvl1, NAME_DEF_RPR) : null;
    const solidFill = defRPr
      ? firstChildElement(defRPr, NAME_SOLID_FILL)
      : null;
    const colorEl = solidFill ? firstColorChild(solidFill) : null;
    if (colorEl) {
      const hex = resolveDrawingColor(colorEl, theme, clrMap);
      if (hex) return hex;
    }
  }
  // No explicit body color in the master: resolve the conventional text token
  // through the (possibly inverted) map.
  return resolveSchemeToken("tx1", theme, clrMap);
};
