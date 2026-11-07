import {
  type PartName,
  type Relationships,
  partName,
  relsPartNameFor,
  resolveTarget,
} from "../opc/index.ts";
import type { OpcPackage, Part } from "./package.ts";

/** Existing parts and names still owned by internal relationships. */
export function reservedPartNames(pkg: OpcPackage): Set<string> {
  const occupied = new Set(pkg.parts.map((part) => part.name.toLowerCase()));
  for (const part of pkg.parts) {
    const match = /^(.*)\/_rels\/([^/]*)\.rels$/i.exec(part.name);
    if (!match || (!match[2] && match[1])) continue;
    const owner = match[2] ? partName(`${match[1]}/${match[2]}`) : null;
    const rels = owner ? pkg.getRels(owner) : pkg.rootRels();
    for (const rel of rels?.items ?? []) {
      if (rel.targetMode !== "Internal") continue;
      const name = resolveTarget(owner ?? "/", rel.target);
      occupied.add(name.toLowerCase());
      occupied.add(relsPartNameFor(name).toLowerCase());
    }
  }
  return occupied;
}

/**
 * Copy an OPC dependency graph without interpreting its content. Relationship
 * IDs remain local to each copied part; only internal targets change. Shared
 * dependencies and cycles remain shared. Validate the graph before adding any
 * parts, so a missing dependency does not leave half a copied graph behind.
 * The returned map uses OPC's case-insensitive source names as keys.
 */
export const copyPartGraph = (
  source: OpcPackage,
  target: OpcPackage,
  roots: ReadonlyArray<PartName>,
  copyData?: (part: Readonly<Part>) => Uint8Array,
): ReadonlyMap<string, PartName> => {
  const graph = new Map<string, { part: Part; rels: Relationships | null }>();
  const visit = (name: PartName): void => {
    const key = name.toLowerCase();
    if (graph.has(key)) return;
    const part = source.getPart(name);
    if (!part) throw new Error(`cannot copy missing dependency ${name}`);
    const rels = source.getRels(part.name);
    graph.set(key, { part, rels });
    for (const rel of rels?.items ?? []) {
      if (rel.targetMode === "Internal")
        visit(resolveTarget(part.name, rel.target));
    }
  };
  for (const root of roots) visit(root);
  // Higher-level copies can rebase document identities. Prepare every payload
  // before adding any parts, preserving graph validation's atomicity.
  const payloads = new Map(
    [...graph].map(([key, { part }]) => [
      key,
      (copyData ? copyData(part) : part.data).slice(),
    ]),
  );

  const names = new Map<string, PartName>();
  const occupied = reservedPartNames(target);
  // A dangling relationship still owns its target name. Reusing it for new
  // content would silently make the old relationship point to unrelated data.
  // Reserve these names before allocating any parts, including missing owners.
  // Reserve original source names first, so a collision suffix cannot steal
  // another source part's available name. Reserve relationship parts too.
  for (const { part } of graph.values()) {
    if (
      !occupied.has(part.name.toLowerCase()) &&
      !occupied.has(relsPartNameFor(part.name).toLowerCase())
    ) {
      names.set(part.name.toLowerCase(), part.name);
      occupied.add(part.name.toLowerCase());
      occupied.add(relsPartNameFor(part.name).toLowerCase());
    }
  }
  for (const { part } of graph.values()) {
    const key = part.name.toLowerCase();
    if (names.has(key)) continue;
    const dot = part.name.lastIndexOf(".");
    const split = dot > part.name.lastIndexOf("/") ? dot : part.name.length;
    let n = 1;
    let name: PartName;
    do {
      name = partName(
        `${part.name.slice(0, split)}_copy${n++}${part.name.slice(split)}`,
      );
    } while (
      occupied.has(name.toLowerCase()) ||
      occupied.has(relsPartNameFor(name).toLowerCase())
    );
    names.set(key, name);
    occupied.add(name.toLowerCase());
    occupied.add(relsPartNameFor(name).toLowerCase());
  }
  for (const [key, { part, rels }] of graph) {
    const name = names.get(key)!;
    target.addPart(name, part.contentType, payloads.get(key)!);
    if (rels) {
      target.setRels(name, {
        items: rels.items.map((r) => ({
          ...r,
          target:
            r.targetMode === "External"
              ? r.target
              : names.get(resolveTarget(part.name, r.target).toLowerCase())!,
        })),
      });
    }
  }
  return names;
};
