import type { OpcPackage, Part } from "../../internal/parts/package.ts";
import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
import {
  NS,
  getAttrValue,
  qname,
  walkElements,
} from "../../internal/xml/index.ts";

const FIELDS = ["panose", "pitchFamily", "charset"] as const;
type FontDescriptor = Partial<Record<(typeof FIELDS)[number], string>>;
const cache = new WeakMap<
  OpcPackage,
  {
    parts: { part: Part; data: Uint8Array }[];
    fonts: ReadonlyMap<string, FontDescriptor>;
  }
>();
const textParts = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
  "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
]);
const nonText = new Set([
  "spPr",
  "grpSpPr",
  "blipFill",
  "extLst",
  "nvSpPr",
  "nvPicPr",
  "nvCxnSpPr",
  "nvGrpSpPr",
  "nvGraphicFramePr",
]);
const decoder = new TextDecoder();

/** Read native descriptors declared elsewhere in a presentation's text.
 * Some producers describe a typeface only in an unused layout or another slide.
 * Copy consensus attributes with the text so removing that donor cannot change
 * font matching. Missing attributes do not disagree; conflicting declarations
 * never produce invented metadata. Local/ancestor descriptors take precedence.
 */
export const sharedFontDescriptors = (
  pkg: OpcPackage,
): ReadonlyMap<string, FontDescriptor> => {
  const parts = pkg.parts.filter((p) => textParts.has(p.contentType));
  const hit = cache.get(pkg);
  if (
    hit &&
    hit.parts.length === parts.length &&
    parts.every(
      (p, i) => p === hit.parts[i]!.part && p.data === hit.parts[i]!.data,
    )
  )
    return hit.fonts;
  const declarations = new Map<string, Map<string, string | null>>();
  for (const part of parts) {
    if (!/\b(?:panose|pitchFamily|charset)\s*=/.test(decoder.decode(part.data)))
      continue;
    try {
      walkElements(readOnlyPartRoot(part), (node) => {
        if (
          (node.name.namespaceURI === NS.dml ||
            node.name.namespaceURI === NS.pml) &&
          nonText.has(node.name.localName)
        )
          return false;
        if (
          node.name.namespaceURI !== NS.dml ||
          !["latin", "ea", "cs", "sym", "buFont"].includes(node.name.localName)
        )
          return;
        const family = getAttrValue(node, qname("", "typeface", ""))
          ?.trim()
          .toLowerCase();
        if (!family || family.startsWith("+")) return;
        let fields = declarations.get(family);
        if (!fields) {
          fields = new Map();
          declarations.set(family, fields);
        }
        for (const name of FIELDS) {
          const value = getAttrValue(node, qname("", name, ""));
          if (value === null) continue;
          // LOGFONT's zero pitch/family is unspecified; an all-zero PANOSE
          // similarly supplies no classification. Neither conflicts with a
          // descriptor of the same face elsewhere in the source package.
          if (
            (name === "pitchFamily" && Number(value) === 0) ||
            (name === "panose" && /^0{20}$/.test(value.trim()))
          )
            continue;
          const normalized =
            name === "panose" ? value.trim().toUpperCase() : value.trim();
          const previous = fields.get(name);
          fields.set(
            name,
            previous === undefined || previous === normalized
              ? normalized
              : null,
          );
        }
        return;
      });
    } catch {
      // A damaged unused part cannot stop an otherwise valid text import.
    }
  }
  const fonts = new Map<string, FontDescriptor>();
  for (const [family, fields] of declarations) {
    const descriptor: FontDescriptor = {};
    for (const name of FIELDS) {
      const value = fields.get(name);
      if (value !== undefined && value !== null) descriptor[name] = value;
    }
    fonts.set(family, descriptor);
  }
  cache.set(pkg, {
    parts: parts.map((part) => ({ part, data: part.data })),
    fonts,
  });
  return fonts;
};
