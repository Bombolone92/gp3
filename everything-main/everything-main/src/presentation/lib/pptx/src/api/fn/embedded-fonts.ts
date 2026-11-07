import {
  nextRelId,
  partName,
  relsPartNameFor,
  resolveTarget,
  type Relationships,
} from "../../internal/opc/index.ts";
import { type OpcPackage, type Part } from "../../internal/parts/package.ts";
import {
  copyPartGraph,
  reservedPartNames,
} from "../../internal/parts/copy-graph.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import { readOpenTypeFont, writeEotFont } from "../../internal/fonts/index.ts";
import {
  NS,
  attr,
  childElements,
  effectiveChildElements,
  elem,
  getAttrValue,
  insertChildByRank,
  isAlternateContent,
  isAlternateContentBranch,
  parseXml,
  qname,
  serializeXml,
  serializeFragment,
  withInheritedNamespaces,
  type XmlDocument,
  type XmlElement,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  type PresentationData,
} from "../_internal-symbols.ts";
import { decode, encode } from "./_helpers.ts";

export type EmbeddedFontStyle = "regular" | "bold" | "italic" | "boldItalic";
export interface EmbeddedFontFace {
  readonly relationshipId: string;
  readonly partName: string;
  readonly contentType: string;
  /** Encoded document payload, not necessarily browser-loadable font bytes. */
  readonly data: Uint8Array;
}
export interface EmbeddedFont {
  readonly typeface: string;
  readonly panose: string | null;
  readonly pitchFamily: string | null;
  readonly charset: string | null;
  readonly faces: Readonly<
    Partial<Record<EmbeddedFontStyle, EmbeddedFontFace>>
  >;
}
const styles: EmbeddedFontStyle[] = ["regular", "bold", "italic", "boldItalic"];
const R_ID = qname("r", "id", NS.officeDocRels);
const plain = (name: string) => qname("", name, "");
const isPml = (e: XmlElement, name: string) =>
  e.name.namespaceURI === NS.pml && e.name.localName === name;
const effective = (e: XmlElement) => [
  ...effectiveChildElements(e, new Set([NS.pml, NS.dml])),
];
const allSchemaChildren = (e: XmlElement): XmlElement[] =>
  childElements(e).flatMap((c) =>
    isAlternateContent(c)
      ? childElements(c)
          .filter(isAlternateContentBranch)
          .flatMap(allSchemaChildren)
      : [c],
  );
const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const clone = (e: XmlElement): XmlElement => ({
  ...e,
  attrs: e.attrs.map((a) => ({ ...a })),
  prefixDecls: new Map(e.prefixDecls),
  children: e.children.map((c) => (c.kind === "element" ? clone(c) : { ...c })),
});

function main(pkg: OpcPackage): {
  part: Part;
  doc: XmlDocument;
  rels: Relationships;
} {
  const roots =
    pkg.rootRels()?.items.filter((r) => r.type === REL_TYPES.officeDocument) ??
    [];
  if (roots.length !== 1 || roots[0]!.targetMode !== "Internal")
    throw Error(
      "embedded fonts: one internal presentation relationship required",
    );
  const part = pkg.getPart(resolveTarget("/", roots[0]!.target));
  if (!part) throw Error("embedded fonts: presentation part is missing");
  const doc = parseXml(decode(part.data));
  if (!isPml(doc.root, "presentation"))
    throw Error("embedded fonts: expected p:presentation");
  return { part, doc, rels: pkg.getRels(part.name) ?? { items: [] } };
}
function face(
  pkg: OpcPackage,
  owner: Part,
  rels: Relationships,
  node: XmlElement,
): EmbeddedFontFace {
  const id = getAttrValue(node, R_ID);
  const matches = rels.items.filter((r) => r.id === id);
  if (
    !id ||
    matches.length !== 1 ||
    matches[0]!.type !== REL_TYPES.font ||
    matches[0]!.targetMode !== "Internal"
  )
    throw Error("embedded fonts: invalid internal font relationship");
  const part = pkg.getPart(resolveTarget(owner.name, matches[0]!.target));
  if (!part) throw Error("embedded fonts: font part is missing");
  return {
    relationshipId: id,
    partName: part.name,
    contentType: part.contentType,
    data: Uint8Array.from(part.data),
  };
}
function entry(
  pkg: OpcPackage,
  owner: Part,
  rels: Relationships,
  node: XmlElement,
): EmbeddedFont {
  const children = effective(node),
    names = children.filter((e) => isPml(e, "font"));
  const typeface =
    names.length === 1 ? getAttrValue(names[0]!, plain("typeface")) : null;
  if (!typeface?.trim())
    throw Error("embedded fonts: one nonempty font typeface required");
  const faces: Partial<Record<EmbeddedFontStyle, EmbeddedFontFace>> = {};
  for (const style of styles) {
    const nodes = children.filter((e) => isPml(e, style));
    if (nodes.length > 1)
      throw Error(`embedded fonts: duplicate ${style} face`);
    if (nodes[0]) faces[style] = face(pkg, owner, rels, nodes[0]);
  }
  return {
    typeface,
    panose: getAttrValue(names[0]!, plain("panose")),
    pitchFamily: getAttrValue(names[0]!, plain("pitchFamily")),
    charset: getAttrValue(names[0]!, plain("charset")),
    faces,
  };
}
function entries(
  pkg: OpcPackage,
  m: ReturnType<typeof main>,
  selected?: ReadonlySet<string>,
) {
  const lists = effective(m.doc.root).filter((e) =>
    isPml(e, "embeddedFontLst"),
  );
  if (lists.length > 1) throw Error("embedded fonts: duplicate font list");
  const rows = lists.flatMap((list) =>
    effective(list)
      .filter((e) => isPml(e, "embeddedFont"))
      .filter(
        (node) =>
          !selected ||
          effective(node).some(
            (e) =>
              isPml(e, "font") &&
              selected.has(
                (getAttrValue(e, plain("typeface")) ?? "").toLowerCase(),
              ),
          ),
      )
      .map((node) => ({ node, info: entry(pkg, m.part, m.rels, node) })),
  );
  const names = new Set<string>();
  for (const row of rows) {
    const key = row.info.typeface.toLowerCase();
    if (names.has(key))
      throw Error(`embedded fonts: duplicate typeface ${row.info.typeface}`);
    names.add(key);
  }
  return rows;
}
/** Read presentation-owned faces through OPC. Does not install or decode them. */
export function getEmbeddedFonts(
  pres: PresentationData,
  options: { onError?: (error: Error, typeface: string | null) => void } = {},
): ReadonlyArray<EmbeddedFont> {
  const pkg = pres[INTERNAL_PACKAGE];
  const m = main(pkg);
  if (!options.onError) return entries(pkg, m).map((row) => row.info);
  const lists = effective(m.doc.root).filter((e) =>
    isPml(e, "embeddedFontLst"),
  );
  if (lists.length > 1) throw Error("embedded fonts: duplicate font list");
  const nodes = lists.flatMap((list) =>
    effective(list).filter((e) => isPml(e, "embeddedFont")),
  );
  const names = nodes.map((node) => {
    const fonts = effective(node).filter((e) => isPml(e, "font"));
    return fonts.length === 1
      ? getAttrValue(fonts[0]!, plain("typeface"))
      : null;
  });
  const counts = new Map<string, number>();
  for (const name of names)
    if (name)
      counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  return nodes.flatMap((node, i) => {
    const name = names[i] ?? null;
    try {
      if (name && counts.get(name.toLowerCase())! > 1)
        throw Error(`embedded fonts: duplicate typeface ${name}`);
      return [entry(pkg, m.part, m.rels, node)];
    } catch (error) {
      options.onError!(
        error instanceof Error ? error : Error(String(error)),
        name,
      );
      return [];
    }
  });
}
const presentationOrder = [
  "sldMasterIdLst",
  "notesMasterIdLst",
  "handoutMasterIdLst",
  "sldIdLst",
  "sldSz",
  "notesSz",
  "smartTags",
  "embeddedFontLst",
  "custShowLst",
  "photoAlbum",
  "custDataLst",
  "kinsoku",
  "defaultTextStyle",
  "modifyVerifier",
  "extLst",
];
function listsForWrite(m: ReturnType<typeof main>): XmlElement[] {
  const lists = allSchemaChildren(m.doc.root).filter((e) =>
    isPml(e, "embeddedFontLst"),
  );
  if (lists.length) return lists;
  const list = elem(qname("p", "embeddedFontLst", NS.pml));
  insertChildByRank(m.doc.root, list, (e) => {
    if (isAlternateContent(e))
      return Math.min(
        ...allSchemaChildren(e)
          .map((c) => presentationOrder.indexOf(c.name.localName))
          .filter((n) => n >= 0),
        Infinity,
      );
    const index =
      e.name.namespaceURI === NS.pml
        ? presentationOrder.indexOf(e.name.localName)
        : -1;
    return index < 0 ? Infinity : index;
  });
  return [list];
}
function existing(list: XmlElement, typeface: string): XmlElement | undefined {
  const rows = allSchemaChildren(list).filter((e) => isPml(e, "embeddedFont"));
  return rows.find((e) =>
    allSchemaChildren(e).some(
      (n) =>
        isPml(n, "font") &&
        getAttrValue(n, plain("typeface"))?.toLowerCase() ===
          typeface.toLowerCase(),
    ),
  );
}
const styleRank = (e: XmlElement): number =>
  isPml(e, "font")
    ? 0
    : styles.includes(e.name.localName as EmbeddedFontStyle) &&
        e.name.namespaceURI === NS.pml
      ? styles.indexOf(e.name.localName as EmbeddedFontStyle) + 1
      : isAlternateContent(e)
        ? Math.min(...allSchemaChildren(e).map(styleRank), Infinity)
        : Infinity;
function styleBranches(
  node: XmlElement,
  style: EmbeddedFontStyle,
): XmlElement[] {
  const rank = styles.indexOf(style) + 1;
  for (const child of childElements(node))
    if (isAlternateContent(child)) {
      const ranks = allSchemaChildren(child)
        .map(styleRank)
        .filter((n) => n > 0 && Number.isFinite(n));
      if (
        ranks.length &&
        rank >= Math.min(...ranks) &&
        rank <= Math.max(...ranks)
      )
        return childElements(child).filter(isAlternateContentBranch);
    }
  return [];
}
function hasEveryStyle(node: XmlElement, style: EmbeddedFontStyle): boolean {
  if (childElements(node).some((e) => isPml(e, style))) return true;
  const branches = styleBranches(node, style);
  return (
    branches.length > 0 &&
    branches.every((branch) => hasEveryStyle(branch, style))
  );
}
function insertStyle(node: XmlElement, style: EmbeddedFontStyle, id: string) {
  if (hasEveryStyle(node, style)) return;
  const branches = styleBranches(node, style);
  if (branches.length) {
    branches.forEach((branch) => insertStyle(branch, style, id));
    return;
  }
  insertChildByRank(
    node,
    elem(qname("p", style, NS.pml), { attrs: [attr(R_ID, id)] }),
    styleRank,
  );
}
function markEmbedding(m: ReturnType<typeof main>): void {
  m.doc.root.attrs = m.doc.root.attrs.filter(
    (a) =>
      a.name.namespaceURI !== "" || a.name.localName !== "embedTrueTypeFonts",
  );
  m.doc.root.attrs.push(attr(plain("embedTrueTypeFonts"), "1"));
}
/** Embed a full licensed individual face. Add text using its legacy family first.
 * .pptx readers require embedded typefaces to be used by the presentation.
 * A different existing face of this family/style is an explicit conflict.
 */
export function embedFont(
  pres: PresentationData,
  bytes: Uint8Array,
  options: { embeddingAuthorized: true },
): void {
  const data = writeEotFont(bytes, options),
    info = readOpenTypeFont(bytes);
  const typeface = info.englishNames.get(1)!;
  const style: EmbeddedFontStyle = info.bold
    ? info.italic
      ? "boldItalic"
      : "bold"
    : info.italic
      ? "italic"
      : "regular";
  const pkg = pres[INTERNAL_PACKAGE],
    m = main(pkg);
  entries(pkg, m); // Validate existing effective entries before any package mutation.
  const lists = listsForWrite(m),
    matches = lists.map((list) => existing(list, typeface));
  let reusableId: string | undefined;
  for (const node of matches)
    if (node) {
      if (
        allSchemaChildren(node)
          .filter((e) => isPml(e, "font"))
          .some(
            (e) =>
              getAttrValue(e, plain("typeface"))?.toLowerCase() !==
              typeface.toLowerCase(),
          )
      )
        throw Error(
          "embedded fonts: font identity differs between compatibility branches",
        );
      for (const child of allSchemaChildren(node).filter((e) =>
        isPml(e, style),
      )) {
        const old = face(pkg, m.part, m.rels, child);
        if (
          old.contentType !== "application/x-fontdata" ||
          !equalBytes(old.data, data)
        )
          throw Error(`embedded fonts: conflicting ${typeface} ${style} face`);
        reusableId ??= old.relationshipId;
      }
    }
  if (matches.every((node) => node && hasEveryStyle(node, style))) return;
  const id = reusableId ?? nextRelId(m.rels.items.map((r) => r.id));
  if (!reusableId) {
    const occupied = reservedPartNames(pkg);
    let n = 1,
      name = partName(`/ppt/fonts/font${n}.fntdata`);
    while (
      occupied.has(name.toLowerCase()) ||
      occupied.has(relsPartNameFor(name).toLowerCase())
    )
      name = partName(`/ppt/fonts/font${++n}.fntdata`);
    pkg.addPart(name, "application/x-fontdata", data);
    m.rels.items.push({
      id,
      type: REL_TYPES.font,
      target: name,
      targetMode: "Internal",
    });
  }
  lists.forEach((list, i) => {
    let node = matches[i];
    if (!node) {
      node = elem(qname("p", "embeddedFont", NS.pml), {
        children: [
          elem(qname("p", "font", NS.pml), {
            attrs: [
              attr(plain("typeface"), typeface),
              attr(
                plain("panose"),
                [...info.panose]
                  .map((v) => v.toString(16).padStart(2, "0"))
                  .join(""),
              ),
            ],
          }),
        ],
      });
      list.children.push(node);
    }
    insertStyle(node, style, id);
  });
  markEmbedding(m);
  pkg.setRels(m.part.name, m.rels);
  m.part.data = encode(serializeXml(m.doc));
}

/** Transfer selected presentation-owned font entries and their opaque dependency
 * graph, preserving packed payloads and extensions. Callers choose the families
 * actually used by copied content; this does not copy slides or select fonts.
 * Equivalent faces are reused and missing styles are merged. Conflicts fail before any
 * target mutation rather than silently substituting a face. Overlapping subset
 * reconciliation requires an explicit later font-table merge, not byte guesses.
 */
export function importEmbeddedFonts(
  target: PresentationData,
  source: PresentationData,
  typefaces: ReadonlyArray<string>,
): void {
  if (
    !typefaces.length ||
    target[INTERNAL_PACKAGE] === source[INTERNAL_PACKAGE]
  )
    return;
  const src = source[INTERNAL_PACKAGE],
    dst = target[INTERNAL_PACKAGE],
    sm = main(src),
    tm = main(dst);
  const requested = new Set(typefaces.map((n) => n.toLowerCase()));
  const rows = entries(src, sm, requested);
  const known = new Set(rows.map((r) => r.info.typeface.toLowerCase()));
  for (const name of requested)
    if (!known.has(name))
      throw Error(`embedded fonts: source typeface ${name} is not embedded`);
  entries(dst, tm, requested);
  const lists = listsForWrite(tm);
  const identity = (e: XmlElement, omitStyles = false): string => {
    const value = clone(e);
    if (omitStyles)
      value.children = value.children.filter(
        (c) =>
          c.kind !== "element" ||
          !(
            c.name.namespaceURI === NS.pml &&
            styles.includes(c.name.localName as EmbeddedFontStyle)
          ),
      );
    const normalize = (n: XmlElement): void => {
      n.attrs = n.attrs.map((a) =>
        a.name.namespaceURI === NS.officeDocRels
          ? { ...a, value: "relationship" }
          : a,
      );
      n.children = n.children.filter(
        (c) => !(c.kind === "text" && !c.data.trim()),
      );
      childElements(n).forEach(normalize);
    };
    normalize(value);
    const nativeOnly = (n: XmlElement): boolean =>
      n.name.namespaceURI === NS.pml &&
      ["embeddedFont", "font", ...styles].includes(n.name.localName) &&
      n.attrs.every(
        (a) =>
          (a.name.namespaceURI === NS.officeDocRels &&
            a.name.localName === "id") ||
          (a.name.namespaceURI === "" &&
            ["typeface", "panose", "pitchFamily", "charset"].includes(
              a.name.localName,
            )),
      ) &&
      childElements(n).every(nativeOnly);
    if (nativeOnly(value)) {
      const canonical = (n: XmlElement): unknown => ({
        name: [n.name.namespaceURI, n.name.localName],
        attrs: n.attrs
          .map((a) => [a.name.namespaceURI, a.name.localName, a.value])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        children: n.children.map((c) =>
          c.kind === "element" ? canonical(c) : c,
        ),
      });
      return JSON.stringify(canonical(value));
    }
    return serializeFragment(value);
  };
  const hasExtraRefs = (e: XmlElement): boolean =>
    e.attrs.some(
      (a) =>
        a.name.namespaceURI === NS.officeDocRels &&
        !(
          styles.includes(e.name.localName as EmbeddedFontStyle) &&
          e.name.namespaceURI === NS.pml &&
          a.name.localName === "id"
        ),
    ) || childElements(e).some(hasExtraRefs);
  const pending: Array<{
    list: XmlElement;
    node: XmlElement | undefined;
    additions: XmlElement[];
    row: (typeof rows)[number];
  }> = [];
  for (const row of rows)
    for (const list of lists) {
      const node = existing(list, row.info.typeface);
      if (!node) {
        pending.push({ list, node, row, additions: [row.node] });
        continue;
      }
      const old = entry(dst, tm.part, tm.rels, node);
      if (
        old.panose !== row.info.panose ||
        old.pitchFamily !== row.info.pitchFamily ||
        old.charset !== row.info.charset
      )
        throw Error(
          `embedded fonts: conflicting ${row.info.typeface} descriptor`,
        );
      // Preserve opaque entry metadata. Reconciliation of extension-owned
      // dependencies needs a semantic graph merge rather than dropping them.
      if (identity(node, true) !== identity(row.node, true))
        throw Error(
          `embedded fonts: conflicting ${row.info.typeface} entry metadata`,
        );
      if (hasExtraRefs(node) || hasExtraRefs(row.node))
        throw Error(
          `embedded fonts: ${row.info.typeface} extension dependency merge required`,
        );
      const additions: XmlElement[] = [];
      for (const style of styles) {
        const incoming = row.info.faces[style];
        if (!incoming) continue; // Additional destination styles remain intact.
        const sourceNodes = allSchemaChildren(row.node).filter((e) =>
          isPml(e, style),
        );
        const targetNodes = allSchemaChildren(node).filter((e) =>
          isPml(e, style),
        );
        for (let i = 0; i < targetNodes.length; i++) {
          const a = face(dst, tm.part, tm.rels, targetNodes[i]!);
          const sourceNode = sourceNodes[Math.min(i, sourceNodes.length - 1)]!;
          const b = face(src, sm.part, sm.rels, sourceNode);
          if (
            a.contentType !== b.contentType ||
            !equalBytes(a.data, b.data) ||
            identity(targetNodes[i]!) !== identity(sourceNode)
          )
            throw Error(
              `embedded fonts: conflicting ${row.info.typeface} ${style} face`,
            );
        }
        if (!hasEveryStyle(node, style)) {
          const original = childElements(row.node).find((e) => isPml(e, style));
          if (!original)
            throw Error(
              `embedded fonts: ${row.info.typeface} compatibility face merge required`,
            );
          additions.push(withInheritedNamespaces(original, [row.node]));
        }
      }
      if (additions.length) pending.push({ list, node, row, additions });
    }
  if (!pending.length) return;
  const referenced = new Set<string>();
  const scan = (e: XmlElement) => {
    for (const a of e.attrs)
      if (a.name.namespaceURI === NS.officeDocRels) referenced.add(a.value);
    childElements(e).forEach(scan);
  };
  pending.forEach((plan) => plan.additions.forEach(scan));
  const rels = [...referenced].map((id) => {
    const matches = sm.rels.items.filter((r) => r.id === id);
    if (matches.length !== 1)
      throw Error(`embedded fonts: missing/duplicate dependency ${id}`);
    return matches[0]!;
  });
  const names = copyPartGraph(
    src,
    dst,
    rels
      .filter((r) => r.targetMode === "Internal")
      .map((r) => resolveTarget(sm.part.name, r.target)),
  );
  const ids = new Map<string, string>();
  for (const rel of rels) {
    const id = nextRelId(tm.rels.items.map((r) => r.id));
    ids.set(rel.id, id);
    tm.rels.items.push({
      ...rel,
      id,
      target:
        rel.targetMode === "External"
          ? rel.target
          : names.get(resolveTarget(sm.part.name, rel.target).toLowerCase())!,
    });
  }
  const rebind = (e: XmlElement) => {
    for (let i = 0; i < e.attrs.length; i++) {
      const a = e.attrs[i]!;
      if (a.name.namespaceURI === NS.officeDocRels)
        e.attrs[i] = { ...a, value: ids.get(a.value)! };
    }
    childElements(e).forEach(rebind);
  };
  const insert = (
    parent: XmlElement,
    addition: XmlElement,
    style: EmbeddedFontStyle,
  ): void => {
    if (hasEveryStyle(parent, style)) return;
    const branches = styleBranches(parent, style);
    if (branches.length) {
      branches.forEach((branch) => insert(branch, addition, style));
      return;
    }
    const node = clone(addition);
    rebind(node);
    insertChildByRank(parent, node, styleRank);
  };
  for (const plan of pending) {
    if (!plan.node) {
      const node = clone(withInheritedNamespaces(plan.row.node, [sm.doc.root]));
      rebind(node);
      plan.list.children.push(node);
    } else
      for (const addition of plan.additions)
        insert(
          plan.node,
          addition,
          addition.name.localName as EmbeddedFontStyle,
        );
  }
  markEmbedding(tm);
  dst.setRels(tm.part.name, tm.rels);
  tm.part.data = encode(serializeXml(tm.doc));
}
