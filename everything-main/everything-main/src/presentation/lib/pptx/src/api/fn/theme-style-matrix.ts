import { NS, type XmlElement } from "../../internal/xml/index.ts";

const fillChoices = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "blipFill",
  "pattFill",
  "grpFill",
]);
const entries = new Map<string, ReadonlySet<string>>([
  ["fillStyleLst", fillChoices],
  ["bgFillStyleLst", fillChoices],
  ["lnStyleLst", new Set(["ln"])],
  ["effectStyleLst", new Set(["effectStyle"])],
]);

/** CT_StyleMatrix lists index their qualified native entries. Opaque foreign
 * children and extension payloads remain XML, without becoming style slots. */
export const styleMatrixEntries = (
  list: XmlElement | null,
  name: string,
): XmlElement[] =>
  list?.children.filter(
    (c): c is XmlElement =>
      c.kind === "element" &&
      c.name.namespaceURI === NS.dml &&
      (entries.get(name)?.has(c.name.localName) ?? false),
  ) ?? [];
