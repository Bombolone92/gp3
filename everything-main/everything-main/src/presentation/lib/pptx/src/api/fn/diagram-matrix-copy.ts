import { REL_TYPES } from "../../internal/presentationml/index.ts";
import { INTERNAL_PACKAGE } from "../_internal-symbols.ts";
import {
  type PartName,
  type Relationship,
  nextRelId,
  resolveTarget,
} from "../../internal/opc/index.ts";
import type { OpcPackage, Part } from "../../internal/parts/index.ts";
import {
  NS,
  type XmlElement,
  attr,
  firstChildElement,
  getAttrValue,
  parseXml,
  qname,
  serializeXml,
} from "../../internal/xml/index.ts";
import type { DiagramColorCopy } from "./diagram-color-copy.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import { cloneShapeSource } from "./shape-source.ts";
import { resolveDrawingColor } from "./shape-color.ts";
import { themeForPart, themeForSlide } from "./shape-theme.ts";
import { styleMatrixEntries } from "./theme-style-matrix.ts";

const child = (el: XmlElement | null, name: string) =>
  el && firstChildElement(el, qname("", name, NS.dml));
const value = (el: XmlElement, name: string) =>
  getAttrValue(el, qname("", name, ""));
const elements = (el: XmlElement | null) =>
  el?.children.filter((e): e is XmlElement => e.kind === "element") ?? [];
const lists = new Map<string, string>([
  ["fillRef", "fillStyleLst"],
  ["lnRef", "lnStyleLst"],
  ["effectRef", "effectStyleLst"],
]);
const diagramNamespaces = new Set<string>([
  NS.diagram,
  NS.diagramDrawing,
  NS.dml,
  NS.mc,
]);
const ownerNamespaces = new Set<string>([...diagramNamespaces, NS.pml]);
const sameBytes = (a: Part, b: Part): boolean => {
  if (a.contentType !== b.contentType || a.data.length !== b.data.length)
    return false;
  if (a.data === b.data) return true;
  for (let i = 0; i < a.data.length; i++)
    if (a.data[i] !== b.data[i]) return false;
  return true;
};
// A flat structural event stream handles deep XML without recursive escaping.
// Opaque extension content retains whitespace and effective prefix bindings.
const canonical = (
  root: XmlElement,
  inherited = new Map<string, string>(),
): string => {
  type Visit =
    | { el: XmlElement; scope: Map<string, string>; opaque: boolean }
    | { value: unknown };
  const output: unknown[] = [],
    pending: Visit[] = [{ el: root, scope: inherited, opaque: false }];
  while (pending.length) {
    const current = pending.pop()!;
    if ("value" in current) {
      output.push(current.value);
      continue;
    }
    const { el } = current,
      scope = new Map([...current.scope, ...el.prefixDecls]);
    const opaque =
      current.opaque ||
      el.name.namespaceURI !== NS.dml ||
      el.name.localName === "extLst" ||
      el.attrs.some(
        (a) =>
          a.name.namespaceURI !== "" &&
          a.name.namespaceURI !== NS.dml &&
          a.name.namespaceURI !== NS.officeDocRels,
      );
    output.push([
      "open",
      el.name.namespaceURI,
      el.name.localName,
      el.attrs
        .map((a) => [a.name.namespaceURI, a.name.localName, a.value])
        .sort(),
      opaque ? [...scope].sort() : null,
    ]);
    pending.push({ value: ["close"] });
    for (let i = el.children.length - 1; i >= 0; i--) {
      const child = el.children[i]!;
      if (child.kind === "element") pending.push({ el: child, scope, opaque });
      else if (
        opaque ||
        child.kind !== "text" ||
        child.data.trim() ||
        el.name.localName === "t"
      )
        pending.push({ value: child });
    }
  }
  return JSON.stringify(output);
};
const namespaceScopes = (root: XmlElement) => {
  const scopes = new WeakMap<XmlElement, Map<string, string>>();
  const pending = [{ el: root, scope: new Map<string, string>() }];
  while (pending.length) {
    const { el, scope } = pending.pop()!;
    const next = new Map([...scope, ...el.prefixDecls]);
    scopes.set(el, next);
    for (const child of elements(el)) pending.push({ el: child, scope: next });
  }
  return scopes;
};

/** Keep diagram style references native when their destination theme changes.
 * Import referenced matrix entries instead of baking paint into layout/data
 * points. Palettes and phClr remain dynamic, including on native reflow.
 * Existing entries retain their indices; source colors and resource ownership
 * are preserved. Preparation never mutates either package.
 */
export const createDiagramMatrixCopy = (
  options: DiagramColorCopy & { readonly targetThemeOwner?: PartName },
  target: OpcPackage,
) => {
  if (!options.preservePaintFormatting || !options.targetThemeOwner)
    return null;
  const source = themeForSlide(options.sourceSlide);
  const destination = themeForPart(target, options.targetThemeOwner);
  if (!source || !destination) return null;
  const sourceMatrix = child(child(source.root, "themeElements"), "fmtScheme");
  const doc = parseXml(new TextDecoder().decode(destination.data));
  const targetMatrix = child(child(doc.root, "themeElements"), "fmtScheme");
  if (!sourceMatrix || !targetMatrix) return null;
  const sourcePkg = options.sourceSlide[INTERNAL_PACKAGE];
  const colorMap = getEffectiveColorMap(options.sourceSlide);
  const sourceRels = sourcePkg.getRels(source.partName)?.items ?? [];
  const rels = target.getRels(destination.partName) ?? { items: [] };
  const used = new Set(rels.items.map((r) => r.id));
  const reservedIds = [doc.root];
  while (reservedIds.length) {
    const node = reservedIds.pop()!;
    for (const a of node.attrs)
      if (a.name.namespaceURI === NS.officeDocRels) used.add(a.value);
    reservedIds.push(...elements(node));
  }
  const imported: { source: Relationship; copied: Relationship }[] = [];
  const relationshipIds = new Map<string, string>();
  const mapped = new Map<string, number>();
  const keys = new Map<string, Map<string, number>>();
  const roots = new Set<PartName>();
  let changed = false;
  const relationship = (id: string): string => {
    const cached = relationshipIds.get(id);
    if (cached) return cached;
    const rel = sourceRels.find((r) => r.id === id);
    if (!rel) throw new Error(`missing diagram theme relationship ${id}`);
    const resource =
      rel.targetMode === "Internal"
        ? sourcePkg.getPart(resolveTarget(source.partName, rel.target))
        : null;
    if (rel.targetMode === "Internal" && !resource)
      throw new Error(`missing diagram theme dependency ${rel.target}`);
    const match = (
      candidate: Relationship,
      pkg: OpcPackage,
      owner: PartName,
    ): boolean => {
      if (
        candidate.type !== rel.type ||
        candidate.targetMode !== rel.targetMode
      )
        return false;
      if (rel.targetMode === "External") return candidate.target === rel.target;
      const part = pkg.getPart(resolveTarget(owner, candidate.target));
      return (
        !!part &&
        !!resource &&
        sameBytes(part, resource) &&
        !pkg.getRels(part.name)?.items.length &&
        !sourcePkg.getRels(resource.name)?.items.length
      );
    };
    const existing = rels.items.find((r) =>
      match(r, target, destination.partName),
    );
    const staged = imported.find((r) =>
      match(r.source, sourcePkg, source.partName),
    );
    const next = existing?.id ?? staged?.copied.id ?? nextRelId([...used]);
    if (!existing && !staged) {
      used.add(next);
      imported.push({ source: rel, copied: { ...rel, id: next } });
      if (resource) roots.add(resource.name);
    }
    relationshipIds.set(id, next);
    return next;
  };
  // Do not turn an existing dangling reference into imported paint. Audit the
  // theme's PML owners and related diagram definitions only when appending.
  let reserved: Map<string, Set<number>> | undefined;
  const dangling = (listName: string, index: number): boolean => {
    if (!reserved) {
      reserved = new Map();
      const owners = target.parts.filter((p) =>
        /^application\/vnd\.openxmlformats-officedocument\.presentationml\.(?:slide|slideLayout|slideMaster)\+xml$/.test(
          p.contentType,
        ),
      );
      const relevant = new Set<PartName>();
      for (const owner of owners) {
        if (themeForPart(target, owner.name)?.partName !== destination.partName)
          continue;
        relevant.add(owner.name);
        for (const rel of target.getRels(owner.name)?.items ?? [])
          if (
            rel.targetMode === "Internal" &&
            [REL_TYPES.diagramQuickStyle, REL_TYPES.diagramDrawing].some(
              (type) => type === rel.type,
            )
          )
            relevant.add(resolveTarget(owner.name, rel.target));
      }
      for (const name of relevant) {
        const part = target.getPart(name);
        if (!part) continue;
        const xml = new TextDecoder().decode(part.data);
        if (!/(?:fill|ln|effect)Ref\b/.test(xml)) continue;
        let root: XmlElement;
        try {
          root = parseXml(xml).root;
        } catch {
          throw new Error(
            "cannot audit destination diagram theme style references",
          );
        }
        const pending = [{ el: root, style: false }];
        while (pending.length) {
          const { el, style } = pending.pop()!;
          const ns = el.name.namespaceURI,
            name = el.name.localName;
          if (!ownerNamespaces.has(ns) || name === "extLst") continue;
          const inside =
            name === "style" &&
            [NS.pml, NS.diagram, NS.diagramDrawing].some((n) => ns === n)
              ? true
              : style;
          const listName = lists.get(name);
          if (inside && ns === NS.dml && listName) {
            const raw = (value(el, "idx") ?? "").trim(),
              n = Number(raw);
            const background = name === "fillRef" && n > 1000;
            const list = background ? "bgFillStyleLst" : listName;
            if (
              /^\+?\d+$/.test(raw) &&
              n > 0 &&
              n <= 0xffffffff &&
              !(name === "fillRef" && n === 1000) &&
              n - (background ? 1001 : 1) >=
                styleMatrixEntries(
                  child(
                    child(
                      child(destination.root, "themeElements"),
                      "fmtScheme",
                    ),
                    list,
                  ),
                  list,
                ).length
            ) {
              let indices = reserved.get(list);
              if (!indices) {
                indices = new Set();
                reserved.set(list, indices);
              }
              indices.add(n);
            }
          }
          for (const next of elements(el))
            pending.push({ el: next, style: inside });
        }
      }
    }
    return reserved.get(listName)?.has(index) ?? false;
  };
  const scopes = namespaceScopes(source.root),
    targetScopes = namespaceScopes(doc.root);
  const entry = (ref: XmlElement): number | null => {
    const raw = (value(ref, "idx") ?? "").trim(),
      index = Number(raw),
      type = ref.name.localName;
    if (
      !/^\+?\d+$/.test(raw) ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > 0xffffffff
    )
      return null;
    if (!index || (type === "fillRef" && index === 1000)) return null;
    const background = type === "fillRef" && index > 1000;
    const listName = background ? "bgFillStyleLst" : lists.get(type);
    if (!listName) return null;
    const key = `${listName}:${index}`,
      previous = mapped.get(key);
    if (previous !== undefined) return previous;
    const list = child(targetMatrix, listName),
      original = styleMatrixEntries(child(sourceMatrix, listName), listName)[
        index - (background ? 1001 : 1)
      ];
    if (!original || !list) return null;
    const copy = cloneShapeSource(original, source.partName, new WeakMap());
    copy.prefixDecls = new Map(scopes.get(original));
    const pending = [{ el: copy, colors: true }];
    while (pending.length) {
      const { el, colors } = pending.pop()!;
      el.attrs = el.attrs.map((a) =>
        a.name.namespaceURI === NS.officeDocRels
          ? { ...a, value: relationship(a.value) }
          : a,
      );
      const known =
        colors &&
        el.name.namespaceURI === NS.dml &&
        el.name.localName !== "extLst";
      if (
        known &&
        el.name.localName === "schemeClr" &&
        value(el, "val") !== "phClr"
      ) {
        const rgb = resolveDrawingColor(
          { ...el, children: [] },
          source.theme,
          colorMap,
        );
        if (rgb) {
          el.name = qname(el.name.prefix, "srgbClr", NS.dml);
          el.attrs = el.attrs.filter(
            (a) => a.name.namespaceURI !== "" || a.name.localName !== "val",
          );
          el.attrs.push(attr(qname("", "val", ""), rgb.slice(1)));
        }
      }
      for (const nextEl of elements(el))
        pending.push({ el: nextEl, colors: known });
    }
    let indexKeys = keys.get(listName);
    if (!indexKeys) {
      indexKeys = new Map(
        styleMatrixEntries(list, listName).map((e, i) => [
          canonical(e, targetScopes.get(e)),
          i,
        ]),
      );
      keys.set(listName, indexKeys);
    }
    const identity = canonical(copy),
      equivalent = indexKeys.get(identity),
      offset = equivalent ?? styleMatrixEntries(list, listName).length;
    const next = offset + (background ? 1001 : 1);
    if (
      (type === "fillRef" && !background && next >= 1000) ||
      next > 0xffffffff
    )
      throw new Error(
        "diagram theme style matrix has no representable free index",
      );
    if (equivalent === undefined) {
      if (dangling(listName, next))
        throw new Error(
          "diagram theme style import would resolve an existing dangling reference",
        );
      list.children.push(copy);
      indexKeys.set(identity, offset);
      changed = true;
    }
    mapped.set(key, next);
    return next;
  };
  return {
    roots,
    preserve(root: XmlElement): boolean {
      let changed = false;
      const pending = [{ el: root, style: false }];
      while (pending.length) {
        const { el, style } = pending.pop()!,
          ns = el.name.namespaceURI,
          name = el.name.localName;
        if (!diagramNamespaces.has(ns) || name === "extLst") continue;
        const inside =
          (ns === NS.diagram || ns === NS.diagramDrawing) && name === "style"
            ? true
            : style;
        if (inside && ns === NS.dml && lists.get(name)) {
          const index = entry(el);
          if (index !== null && value(el, "idx") !== String(index)) {
            el.attrs = el.attrs.map((a) =>
              a.name.namespaceURI === "" && a.name.localName === "idx"
                ? { ...a, value: String(index) }
                : a,
            );
            changed = true;
          }
        }
        for (const nextEl of elements(el))
          pending.push({ el: nextEl, style: inside });
      }
      return changed;
    },
    commit(names: ReadonlyMap<string, PartName>): void {
      if (!changed) return;
      for (const { source: rel, copied } of imported) {
        if (rel.targetMode === "Internal")
          copied.target = names.get(
            resolveTarget(source.partName, rel.target).toLowerCase(),
          )!;
        rels.items.push(copied);
      }
      if (imported.length) target.setRels(destination.partName, rels);
      target.getPart(destination.partName)!.data = new TextEncoder().encode(
        serializeXml(doc),
      );
    },
  };
};
