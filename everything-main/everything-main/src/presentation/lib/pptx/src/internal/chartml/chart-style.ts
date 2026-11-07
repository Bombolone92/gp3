// Chart preset identity and its c14 (2010 extension) compatibility representation.
import {
  NS,
  type XmlElement,
  attr,
  elem,
  qname,
  childElements,
  effectiveChildElements,
  getAttrValue,
  isAlternateContent,
  isAlternateContentBranch,
  withInheritedNamespaces,
} from "../xml/index.ts";
import type { ChartSpec } from "./types.ts";

const NS_C14 = "http://schemas.microsoft.com/office/drawing/2007/8/2/chart";
type StyleSpec = Pick<ChartSpec, "chartStyle" | "chartStyleVariant">;
const isStyle = (e: XmlElement): boolean =>
  e.name.localName === "style" &&
  (e.name.namespaceURI === NS.chart || e.name.namespaceURI === NS_C14);
const namespaces = new Set([NS.chart, NS_C14]);
// Knowing c14:style does not mean we implement c14:pivotOptions, etc.
const supportsStyleChoice = (uri: string, choice: XmlElement): boolean =>
  namespaces.has(uri) &&
  childElements(choice).every((e) => isStyle(e) || isAlternateContent(e));
const logicalStyle = (root: XmlElement): XmlElement | undefined =>
  [...effectiveChildElements(root, supportsStyleChoice)].find(isStyle);

export const readChartStyle = (root: XmlElement): StyleSpec => {
  const style = logicalStyle(root);
  if (!style) return {};
  const raw = getAttrValue(style, qname("", "val", ""))?.trim();
  // ST_Style is an unsignedByte restriction, not a parseInt prefix.
  if (!raw || !/^\+?\d+$/.test(raw)) return {};
  const n = Number(raw),
    modern = style.name.namespaceURI === NS_C14,
    base = modern ? n - 100 : n;
  if (!Number.isInteger(base) || base < 1 || base > 48) return {};
  return {
    chartStyle: base,
    ...(modern ? { chartStyleVariant: "office2010" } : {}),
  };
};

export const validateChartStyle = (spec: StyleSpec): void => {
  if (
    spec.chartStyle !== undefined &&
    (!Number.isInteger(spec.chartStyle) ||
      spec.chartStyle < 1 ||
      spec.chartStyle > 48)
  )
    throw new RangeError(
      "chartStyle: expected an integer from 1 to 48 (OOXML ST_Style)",
    );
  if (
    spec.chartStyleVariant !== undefined &&
    spec.chartStyleVariant !== "office2010"
  )
    throw new TypeError(
      "chartStyleVariant: expected office2010 or omission for the legacy variant",
    );
  if (spec.chartStyleVariant !== undefined && spec.chartStyle === undefined)
    throw new TypeError("chartStyleVariant requires chartStyle");
};

export const chartStyleElement = (spec: StyleSpec): XmlElement | null => {
  validateChartStyle(spec);
  if (spec.chartStyle === undefined) return null;
  const legacy = elem(qname("c", "style", NS.chart), {
    attrs: [attr(qname("", "val", ""), String(spec.chartStyle))],
  });
  if (spec.chartStyleVariant === undefined) return legacy;
  // MS-ODRAWXML 2.7.3.5: the legacy style must equal c14:style minus 100.
  return elem(qname("mc", "AlternateContent", NS.mc), {
    prefixDecls: new Map([["mc", NS.mc]]),
    children: [
      elem(qname("mc", "Choice", NS.mc), {
        prefixDecls: new Map([["c14", NS_C14]]),
        attrs: [attr(qname("", "Requires", ""), "c14")],
        children: [
          elem(qname("c14", "style", NS_C14), {
            attrs: [attr(qname("", "val", ""), String(spec.chartStyle + 100))],
          }),
        ],
      }),
      elem(qname("mc", "Fallback", NS.mc), { children: [legacy] }),
    ],
  });
};

// A compatibility block containing other known ChartML settings is not an
// independent style slot. Carrying it alongside newly authored settings could
// duplicate/conflict with them; such compound blocks need a broader editor.
const isStyleSlot = (e: XmlElement): boolean => {
  const pending = [e];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (isStyle(node)) continue;
    if (isAlternateContent(node) || isAlternateContentBranch(node)) {
      for (const child of childElements(node)) pending.push(child);
      continue;
    }
    // Unknown extension payloads in the style's branches remain opaque.
    if (node.name.namespaceURI === NS.chart || node.name.namespaceURI === NS.mc)
      return false;
  }
  return true;
};

const containsNativeStyle = (root: XmlElement): boolean => {
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (isStyle(node)) return true;
    if (isAlternateContent(node) || isAlternateContentBranch(node))
      for (const child of childElements(node)) pending.push(child);
  }
  return false;
};

/** Keep an unchanged native style slot, including opaque choices and QName scope. */
export const preserveNativeChartStyle = (
  original: XmlElement,
  rewritten: XmlElement,
  spec: StyleSpec,
): void => {
  const previous = readChartStyle(original);
  if (
    previous.chartStyle !== spec.chartStyle ||
    previous.chartStyleVariant !== spec.chartStyleVariant
  )
    return;
  const source = childElements(original).find((e) => {
    if (isStyle(e)) return true;
    if (!isAlternateContent(e) || !isStyleSlot(e)) return false;
    // Inactive fallback presets are still native compatibility data.
    return containsNativeStyle(e);
  });
  if (!source || !isStyleSlot(source)) return;
  const native = withInheritedNamespaces(source, [original]),
    index = rewritten.children.findIndex(
      (e) => e.kind === "element" && (isStyle(e) || isAlternateContent(e)),
    );
  if (index >= 0) rewritten.children[index] = native;
  else {
    const chartIndex = rewritten.children.findIndex(
      (e) =>
        e.kind === "element" &&
        e.name.namespaceURI === NS.chart &&
        e.name.localName === "chart",
    );
    rewritten.children.splice(chartIndex < 0 ? 0 : chartIndex, 0, native);
  }
};
