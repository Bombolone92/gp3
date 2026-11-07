import {
  type PartName,
  type Relationships,
  parseRels,
  partName,
  resolveTarget,
} from "../../internal/opc/index.ts";
import type { OpcPackage, Part } from "../../internal/parts/index.ts";

const cache = new WeakMap<Part, { data: Uint8Array; rels: Relationships }>();
const decoder = new TextDecoder();
const relationships = (part: Part): Relationships => {
  const previous = cache.get(part);
  if (previous?.data === part.data) return previous.rels;
  const rels = parseRels(decoder.decode(part.data));
  cache.set(part, { data: part.data, rels });
  return rels;
};

/** An image part is a shared resource, including references from unknown parts. */
export const mediaHasOtherRelationships = (
  pkg: OpcPackage,
  owner: PartName,
  id: string,
  media: PartName,
): boolean => {
  const ownerKey = owner.toLowerCase(),
    mediaKey = media.toLowerCase();
  let skippedOwner = false;
  for (const part of pkg.parts) {
    if (
      part.contentType !==
      "application/vnd.openxmlformats-package.relationships+xml"
    )
      continue;
    try {
      const match = /^(.*\/)_rels\/([^/]+)\.rels$/i.exec(part.name);
      const from =
        part.name.toLowerCase() === "/_rels/.rels"
          ? "/"
          : match
            ? partName(`${match[1]}${match[2]}`)
            : null;
      if (!from) return true;
      for (const rel of relationships(part).items) {
        if (rel.targetMode !== "Internal") continue;
        if (resolveTarget(from, rel.target).toLowerCase() !== mediaKey)
          continue;
        if (!skippedOwner && from.toLowerCase() === ownerKey && rel.id === id) {
          skippedOwner = true;
          continue;
        }
        return true;
      }
    } catch {
      // An opaque/malformed relationship table cannot prove sole ownership.
      // Preserve its potential resource; edit the known picture's own copy.
      return true;
    }
  }
  return false;
};
