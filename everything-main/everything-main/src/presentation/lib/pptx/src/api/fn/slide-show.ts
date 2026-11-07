import { resolveTarget } from "../../internal/opc/index.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
import { readThemePart } from "./theme.ts";
import { resolveDrawingColor, resolveDrawingOpacity } from "./shape-color.ts";
import {
  NS,
  effectiveChildElements,
  getAttrValue,
  qname,
  type XmlElement,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  type PresentationData,
} from "../_internal-symbols.ts";

/** Presentation-wide timing preferences, with CT_ShowProperties defaults. */
export interface SlideShowTimingOptions {
  readonly useTimings: boolean;
  readonly loop: boolean;
}

/** The authored show selection. Range indexes are inclusive and one-based.
 * Custom references retain their order, repetitions and explicit hidden slides.
 */
export type SlideShowSelection =
  | { readonly kind: "all" }
  | { readonly kind: "range"; readonly start: number; readonly end: number }
  | {
      readonly kind: "custom";
      readonly id: number;
      readonly slidePartNames: readonly string[];
    };

const isPml = (e: XmlElement, name: string): boolean =>
  e.name.namespaceURI === NS.pml && e.name.localName === name;
const SHOW_NAMESPACES: ReadonlySet<string> = new Set([NS.pml, NS.dml]);
// MS-PPTX §2.2.6 identifies the extension, independently of its XML prefix.
const LASER_EXTENSION = "{EC167BDD-8182-4AB7-AECC-EB403E3ABB37}";

/** All show-property readers must choose the same understood alternative.
 * Understanding laserClr does not imply understanding every p14 show feature.
 * Memoize only within this read, including nested choices, to bound traversal.
 */
const showChildren = () => {
  // effectiveChildElements returns fresh namespace views sharing the source
  // body. Cache that stable body, scoped by bindings that affect MC Requires.
  const known = new WeakMap<XmlElement["children"], Map<string, boolean>>();
  const understood = (parent: XmlElement): boolean => {
    if (parent.attrs.some(({ name }) => name.namespaceURI === NS.p14))
      return false;
    const scope = JSON.stringify(
      [...parent.prefixDecls].sort(([a], [b]) => a.localeCompare(b)),
    );
    let scoped = known.get(parent.children);
    if (!scoped) known.set(parent.children, (scoped = new Map()));
    const previous = scoped.get(scope);
    if (previous !== undefined) return previous;
    scoped.set(scope, false);
    for (const child of effectiveChildElements(parent, supports)) {
      const ns = child.name.namespaceURI;
      if (
        !SHOW_NAMESPACES.has(ns) &&
        !(ns === NS.p14 && child.name.localName === "laserClr")
      )
        return false;
      if (!understood(child)) return false;
    }
    scoped.set(scope, true);
    return true;
  };
  const supports = (uri: string, choice: XmlElement): boolean =>
    SHOW_NAMESPACES.has(uri) || (uri === NS.p14 && understood(choice));
  return (e: XmlElement): XmlElement[] => [
    ...effectiveChildElements(e, supports),
  ];
};

/** Locate presentation properties through their owning OPC relationships. */
const showContext = (pres: PresentationData) => {
  const children = showChildren();
  const pkg = pres[INTERNAL_PACKAGE];
  const mainRel = pkg
    .rootRels()
    ?.items.find(
      (r) => r.type === REL_TYPES.officeDocument && r.targetMode !== "External",
    );
  if (!mainRel) return null;
  const mainName = resolveTarget("/", mainRel.target);
  const main = pkg.getPart(mainName);
  if (!main) return null;
  const propsRel = pkg
    .getRels(mainName)
    ?.items.find(
      (r) => r.type === REL_TYPES.presProps && r.targetMode !== "External",
    );
  if (!propsRel) return { main, show: null, children };
  const props = pkg.getPart(resolveTarget(mainName, propsRel.target));
  if (!props) return { main, show: null, children };
  const root = readOnlyPartRoot(props);
  if (
    root.name.namespaceURI !== NS.pml ||
    root.name.localName !== "presentationPr"
  )
    return { main, show: null, children };
  const show = children(root).find((e) => isPml(e, "showPr")) ?? null;
  return { main, show, children };
};

/** Reads timing preferences without changing XML. Slide timers remain authored
 * even when useTimings disables their playback.
 */
export const getSlideShowTimingOptions = (
  pres: PresentationData,
): SlideShowTimingOptions => {
  const show = showContext(pres)?.show;
  if (!show) return { useTimings: true, loop: false };
  const read = (name: string, fallback: boolean): boolean => {
    const value = getAttrValue(show, qname("", name, ""))?.trim();
    return value === "true" || value === "1"
      ? true
      : value === "false" || value === "0"
        ? false
        : fallback;
  };
  return { useTimings: read("useTimings", true), loop: read("loop", false) };
};

const unsigned = (e: XmlElement, name: string, context: string): number => {
  const text = getAttrValue(e, qname("", name, ""))?.trim();
  const value = text && /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw Error(`The ${context} is invalid.`);
  return value;
};

/** Reads CT_ShowProperties selection and resolves CT_CustomShow slide URIs.
 * A damaged explicit selection is an error, never permission to show all slides.
 * All source XML, custom definitions and relationship bytes remain untouched.
 */
export const getSlideShowSelection = (
  pres: PresentationData,
): SlideShowSelection => {
  const context = showContext(pres);
  if (!context?.show) return { kind: "all" };
  const children = context.children;
  const selected = children(context.show).filter((e) =>
    ["sldAll", "sldRg", "custShow"].some((name) => isPml(e, name)),
  );
  if (selected.length > 1)
    throw Error("Multiple slide show selections are specified.");
  const choice = selected[0];
  if (!choice || isPml(choice, "sldAll")) return { kind: "all" };
  if (isPml(choice, "sldRg")) {
    const start = unsigned(choice, "st", "slide range start"),
      end = unsigned(choice, "end", "slide range end");
    if (!start || start > end) throw Error("The slide range is invalid.");
    return { kind: "range", start, end };
  }
  const id = unsigned(choice, "id", "custom slide show identifier"),
    root = readOnlyPartRoot(context.main);
  if (!isPml(root, "presentation"))
    throw Error("The custom slide show presentation is invalid.");
  const matches = children(root)
    .filter((e) => isPml(e, "custShowLst"))
    .flatMap((e) => children(e))
    .filter((e) => {
      if (!isPml(e, "custShow")) return false;
      const text = getAttrValue(e, qname("", "id", ""))?.trim();
      return !!text && /^[+-]?\d+$/.test(text) && Number(text) === id;
    });
  if (!matches.length) throw Error("The custom slide show was not found.");
  if (matches.length !== 1) throw Error("The custom slide show is ambiguous.");
  const lists = children(matches[0]!).filter((e) => isPml(e, "sldLst"));
  if (lists.length !== 1)
    throw Error("The custom slide show slide list is invalid.");
  const byId = new Map<string, { target: string; valid: boolean }>();
  for (const rel of pres[INTERNAL_PACKAGE].getRels(context.main.name)?.items ??
    []) {
    if (byId.has(rel.id)) byId.get(rel.id)!.valid = false;
    else
      byId.set(rel.id, {
        target: rel.target,
        valid: rel.type === REL_TYPES.slide && rel.targetMode !== "External",
      });
  }
  const slidePartNames = children(lists[0]!)
    .filter((e) => isPml(e, "sld"))
    .map((e) => {
      const id = getAttrValue(e, qname("r", "id", NS.officeDocRels)),
        rel = id === null ? undefined : byId.get(id);
      if (!rel?.valid)
        throw Error("A custom slide show slide relationship is invalid.");
      return resolveTarget(context.main.name, rel.target);
    });
  return { kind: "custom", id, slidePartNames };
};

/** A resolved authored laser-dot color. Absence is separate from viewer defaults. */
export interface SlideShowLaserColor {
  readonly color: string;
  readonly opacity: number;
}

/** Reads the native laser color without changing properties, themes or XML.
 * Scheme colors belong to the presentation's own theme relationship, never an
 * unrelated theme selected by filename. Invalid explicit colors are reported.
 */
export const getSlideShowLaserColor = (
  pres: PresentationData,
): SlideShowLaserColor | null => {
  const context = showContext(pres);
  if (!context?.show) return null;
  const logical = context.children;
  const extensions = logical(context.show)
    .filter((e) => isPml(e, "extLst"))
    .flatMap(logical)
    .filter(
      (e) =>
        isPml(e, "ext") &&
        getAttrValue(e, qname("", "uri", ""))
          ?.trim()
          .toUpperCase() === LASER_EXTENSION,
    );
  if (!extensions.length) return null;
  const invalid = () =>
    Error("The slide show's laser pointer color is invalid or unsupported.");
  const containers = extensions
    .flatMap(logical)
    .filter(
      (e) => e.name.namespaceURI === NS.p14 && e.name.localName === "laserClr",
    );
  if (extensions.length !== 1 || containers.length !== 1) throw invalid();
  const colors = logical(containers[0]!);
  if (colors.length !== 1) throw invalid();
  const pkg = pres[INTERNAL_PACKAGE];
  let theme = null;
  if (
    colors[0]!.name.namespaceURI === NS.dml &&
    colors[0]!.name.localName === "schemeClr"
  ) {
    const rels =
      pkg
        .getRels(context.main.name)
        ?.items.filter((r) => r.type === REL_TYPES.theme) ?? [];
    if (rels.length !== 1 || rels[0]!.targetMode === "External")
      throw invalid();
    const part = pkg.getPart(resolveTarget(context.main.name, rels[0]!.target));
    if (!part) throw invalid();
    theme = readThemePart(part).theme;
  }
  const color = resolveDrawingColor(colors[0]!, theme);
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) throw invalid();
  return { color, opacity: resolveDrawingOpacity(colors[0]!) };
};
