// Shared interpretation of presentation order. Relationship targets are URI
// references, not a prescribed "slides/<filename>" spelling (OPC Part 2).
import { type Relationships, resolveTarget } from "../../internal/opc/index.ts";
import type { OpcPackage, Part } from "../../internal/parts/index.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
} from "../../internal/xml/index.ts";
import {
  ATTR_R_ID,
  NAME_SLD_ID,
  NAME_SLD_ID_LST,
  PRES_PART_NAME,
} from "./_helpers.ts";

export const readSlideEntries = (
  pkg: OpcPackage,
  root: XmlElement,
  rels: Relationships,
) => {
  const list = firstChildElement(root, NAME_SLD_ID_LST);
  const byId = new Map<string, Relationships["items"][number]>();
  for (const rel of rels.items) if (!byId.has(rel.id)) byId.set(rel.id, rel);
  const byName = new Map<string, Part>();
  for (const part of pkg.parts)
    if (!byName.has(part.name.toLowerCase()))
      byName.set(part.name.toLowerCase(), part);
  const entries = (list ? allChildElements(list, NAME_SLD_ID) : []).map(
    (element) => {
      const id = getAttrValue(element, ATTR_R_ID);
      const rel = id === null ? undefined : byId.get(id);
      if (!rel)
        throw new Error(`presentation.xml.rels missing entry for ${id}`);
      if (rel.type !== REL_TYPES.slide || rel.targetMode === "External")
        throw new Error(
          `presentation slide ${id} is not an internal slide relationship`,
        );
      const target = resolveTarget(PRES_PART_NAME, rel.target);
      const part = byName.get(target.toLowerCase());
      if (!part) throw new Error(`slide part ${target} not found`);
      return { element, rel, part };
    },
  );
  return { list, entries };
};

// Mutating an ambiguous list could delete a part still used by another entry
// or lose entries during sorting. Keep reads non-destructive, but reject such
// mutations before any package write.
export const requireUniqueSlideEntries = (
  entries: ReturnType<typeof readSlideEntries>["entries"],
  rels: Relationships,
): void => {
  const parts = new Set<Part>();
  const counts = new Map<string, number>();
  for (const rel of rels.items)
    counts.set(rel.id, (counts.get(rel.id) ?? 0) + 1);
  for (const { rel, part } of entries) {
    if (parts.has(part) || counts.get(rel.id) !== 1)
      throw new Error("presentation contains ambiguous slide relationships");
    parts.add(part);
  }
};
