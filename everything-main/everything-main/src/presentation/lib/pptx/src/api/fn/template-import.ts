import {
  type PartName,
  nextRelId,
  resolveTarget,
} from "../../internal/opc/index.ts";
import { OpcPackage, type Part } from "../../internal/parts/package.ts";
import { copyPartGraph } from "../../internal/parts/copy-graph.ts";
import { createTextFieldCopy } from "./text-field-copy.ts";
import {
  REL_TYPES,
  readSlideLayoutPart,
} from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlDocument,
  type XmlElement,
  attr,
  childElements,
  elem,
  getAttrValue,
  isAlternateContent,
  isAlternateContentBranch,
  parseXml,
  qname,
  serializeXml,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  LAYOUT_PART,
  LAYOUT_PART_NAME,
  SLIDE_PART_NAME,
  type PresentationData,
  type SlideData,
  type SlideLayoutData,
} from "../_internal-symbols.ts";
import { SLIDE_LAYOUT_CONTENT_TYPE, decode, encode } from "./_helpers.ts";

const MASTER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";
// ST_SlideMasterId and ST_SlideLayoutId share the unsigned high-half range.
const TEMPLATE_ID_MIN = 2 ** 31;
const TEMPLATE_ID_MAX = 2 ** 32 - 1;
const ID = qname("", "id", "");
const R_ID = qname("r", "id", NS.officeDocRels);
const isPml = (e: XmlElement, name: string) =>
  e.name.namespaceURI === NS.pml && e.name.localName === name;

// Visit all preserved compatibility branches in the actual schema slot, never
// similarly named nodes inside foreign extensions. Both branches must export.
const schemaChildren = (parent: XmlElement): XmlElement[] =>
  childElements(parent).flatMap((child) =>
    isAlternateContent(child)
      ? childElements(child)
          .filter(isAlternateContentBranch)
          .flatMap(schemaChildren)
      : [child],
  );
const lists = (root: XmlElement, name: string) =>
  schemaChildren(root).filter((e) => isPml(e, name));
const layoutEntries = (root: XmlElement) =>
  lists(root, "sldLayoutIdLst").flatMap((list) =>
    schemaChildren(list).filter((e) => isPml(e, "sldLayoutId")),
  );
const readRoot = (part: Part, name: string): XmlDocument => {
  const doc = parseXml(decode(part.data));
  if (!isPml(doc.root, name))
    throw new Error(`importSlideTemplates: ${part.name} is not p:${name}`);
  return doc;
};
const relatedPart = (pkg: OpcPackage, name: PartName, type: string) => {
  const rels = pkg.getRels(name)?.items.filter((r) => r.type === type);
  if (rels?.length !== 1 || rels[0]?.targetMode !== "Internal")
    throw new Error(`importSlideTemplates: ${name} needs one internal ${type}`);
  const resolved = resolveTarget(name, rels[0].target);
  const part = pkg.getPart(resolved);
  if (!part) throw new Error(`cannot copy missing dependency ${resolved}`);
  return part;
};

/**
 * Copy the native templates used by source slides into a destination package.
 * Returns destination layout handles in input order for use with importSlide.
 * Master/layout artwork, themes, transitions and their dependency graphs remain
 * editable native parts. This does not copy slide bodies or change the target's
 * presentation-wide theme, slide size, text defaults or show preferences.
 * To retain native geometry inheritance when importing the body, use
 * `importSlide(target, slide, layout, { preserveGeometry: false })`. Leave text
 * and paint preservation disabled to let those properties follow the template
 * too; enabling them intentionally materializes resolved source formatting.
 *
 * Slides must belong to one source package. A batch shares each template and
 * dependency once, including repeated layouts. When source formatting is
 * kept, unused sibling layouts are omitted. Unknown references to
 * other layouts retain those dependencies. All validation precedes mutation.
 */
export const importSlideTemplates = (
  targetPres: PresentationData,
  sourceSlides: ReadonlyArray<SlideData>,
): ReadonlyArray<SlideLayoutData> => {
  if (!sourceSlides.length) return [];
  const source = sourceSlides[0]![INTERNAL_PACKAGE];
  if (sourceSlides.some((slide) => slide[INTERNAL_PACKAGE] !== source))
    throw new Error(
      "importSlideTemplates: slides belong to different packages",
    );
  const roots = sourceSlides.map((slide) => {
    if (!source.getPart(slide[SLIDE_PART_NAME]))
      throw new Error("importSlideTemplates: source slide is missing");
    const layout = relatedPart(
      source,
      slide[SLIDE_PART_NAME],
      REL_TYPES.slideLayout,
    );
    if (layout.contentType !== SLIDE_LAYOUT_CONTENT_TYPE)
      throw new Error(
        `importSlideTemplates: ${layout.name} is not a slide layout`,
      );
    readRoot(layout, "sldLayout");
    return layout.name;
  });
  const target = targetPres[INTERNAL_PACKAGE];
  const mainRel = target
    .rootRels()
    ?.items.find(
      (r) => r.type === REL_TYPES.officeDocument && r.targetMode === "Internal",
    );
  const main = mainRel && target.getPart(resolveTarget("/", mainRel.target));
  if (!main)
    throw new Error("importSlideTemplates: target presentation is missing");
  const presentation = readRoot(main, "presentation");
  const mainRels = target.getRels(main.name) ?? { items: [] };

  // A copy-on-write view shares immutable byte buffers, without recompressing
  // the whole source deck or duplicating its large media assets in memory.
  const view = OpcPackage.empty();
  for (const part of source.parts) view.parts.push({ ...part });
  const selected = new Set(roots.map((name) => name.toLowerCase()));
  const masters = new Map<string, { part: Part; doc: XmlDocument }>();
  let graph = new Map<string, Part>();
  let previousSize = -1;
  while (previousSize !== selected.size) {
    previousSize = selected.size;
    graph = new Map();
    const visit = (name: PartName): void => {
      const key = name.toLowerCase();
      if (graph.has(key)) return;
      const original = source.getPart(name);
      if (!original) throw new Error(`cannot copy missing dependency ${name}`);
      if (original.contentType === SLIDE_LAYOUT_CONTENT_TYPE) {
        selected.add(key);
        const master = relatedPart(
          source,
          original.name,
          REL_TYPES.slideMaster,
        );
        if (master.contentType !== MASTER_CONTENT_TYPE)
          throw new Error(
            `importSlideTemplates: ${master.name} is not a slide master`,
          );
        if (
          !source
            .getRels(master.name)
            ?.items.some(
              (r) =>
                r.type === REL_TYPES.slideLayout &&
                r.targetMode === "Internal" &&
                resolveTarget(master.name, r.target).toLowerCase() === key,
            )
        )
          throw new Error(
            `importSlideTemplates: ${master.name} does not reference layout ${original.name}`,
          );
      }
      if (original.contentType === MASTER_CONTENT_TYPE) {
        const doc = readRoot(original, "sldMaster");
        const entries = new Set(layoutEntries(doc.root));
        const otherRefs = new Set<string>();
        const collect = (node: XmlElement): void => {
          for (const a of node.attrs)
            if (
              a.name.namespaceURI === NS.officeDocRels &&
              !(entries.has(node) && a.name.localName === "id")
            )
              otherRefs.add(a.value);
          childElements(node).forEach(collect);
        };
        collect(doc.root);
        const rels = source.getRels(original.name) ?? { items: [] };
        const kept = rels.items.filter(
          (r) =>
            r.type !== REL_TYPES.slideLayout ||
            otherRefs.has(r.id) ||
            (r.targetMode === "Internal" &&
              selected.has(
                resolveTarget(original.name, r.target).toLowerCase(),
              )),
        );
        const keptIds = new Set(kept.map((r) => r.id));
        const prune = (parent: XmlElement): void => {
          parent.children = parent.children.filter(
            (c) =>
              c.kind !== "element" ||
              !entries.has(c) ||
              keptIds.has(getAttrValue(c, R_ID) ?? ""),
          );
          childElements(parent).forEach(prune);
        };
        prune(doc.root);
        for (const r of kept.filter((r) => r.type === REL_TYPES.slideLayout)) {
          if (
            !layoutEntries(doc.root).some((e) => getAttrValue(e, R_ID) === r.id)
          )
            throw new Error(
              `importSlideTemplates: master ${name} does not register layout ${r.id}`,
            );
        }
        masters.set(key, { part: original, doc });
        view.getPart(original.name)!.data = encode(serializeXml(doc));
        view.setRels(original.name, { items: kept });
      }
      const part = view.getPart(original.name)!;
      graph.set(key, part);
      for (const rel of view.getRels(part.name)?.items ?? [])
        if (rel.targetMode === "Internal")
          visit(resolveTarget(part.name, rel.target));
    };
    roots.forEach(visit);
  }

  // Reserve destination IDs from their real schema positions, including all
  // alternate branches. On high-end exhaustion, reuse the lowest free value.
  const used = new Set<number>();
  const reserve = (entries: XmlElement[]) => {
    for (const e of entries) {
      const value = Number(getAttrValue(e, ID));
      if (
        Number.isInteger(value) &&
        value >= TEMPLATE_ID_MIN &&
        value <= TEMPLATE_ID_MAX
      )
        used.add(value);
    }
  };
  reserve(
    lists(presentation.root, "sldMasterIdLst").flatMap((list) =>
      schemaChildren(list).filter((e) => isPml(e, "sldMasterId")),
    ),
  );
  for (const part of target.parts)
    if (part.contentType === MASTER_CONTENT_TYPE)
      reserve(layoutEntries(readRoot(part, "sldMaster").root));
  let next = TEMPLATE_ID_MIN;
  for (const value of used) next = Math.max(next, value + 1);
  if (next > TEMPLATE_ID_MAX) next = TEMPLATE_ID_MIN;
  const allocate = () => {
    if (used.size >= TEMPLATE_ID_MAX - TEMPLATE_ID_MIN + 1)
      throw new Error("importSlideTemplates: template IDs exhausted");
    while (used.has(next))
      next = next === TEMPLATE_ID_MAX ? TEMPLATE_ID_MIN : next + 1;
    const id = next;
    next = next === TEMPLATE_ID_MAX ? TEMPLATE_ID_MIN : next + 1;
    used.add(id);
    return id;
  };
  const registrations: { sourceName: PartName; id: number; relId: string }[] =
    [];
  for (const [key, { part, doc }] of masters) {
    if (!graph.has(key)) continue;
    const masterId = allocate();
    const ids = new Map<string, number>();
    for (const entry of layoutEntries(doc.root)) {
      const relId = getAttrValue(entry, R_ID);
      if (!relId)
        throw new Error(
          `importSlideTemplates: ${part.name} has a layout without r:id`,
        );
      if (!ids.has(relId)) ids.set(relId, allocate());
      entry.attrs = entry.attrs.filter(
        (a) => a.name.namespaceURI !== "" || a.name.localName !== "id",
      );
      entry.attrs.push(attr(ID, String(ids.get(relId))));
    }
    view.getPart(part.name)!.data = encode(serializeXml(doc));
    const relId = nextRelId([
      ...mainRels.items.map((r) => r.id),
      ...registrations.map((r) => r.relId),
    ]);
    registrations.push({ sourceName: part.name, id: masterId, relId });
  }
  const fieldCopy = createTextFieldCopy(target);
  for (const part of graph.values()) part.data = fieldCopy.bytes(part);
  const layoutModels = roots.map((name) =>
    readSlideLayoutPart(readRoot(view.getPart(name)!, "sldLayout").root),
  );

  const names = copyPartGraph(view, target, roots);
  let masterLists = lists(presentation.root, "sldMasterIdLst");
  if (!masterLists.length) {
    const list = elem(qname("p", "sldMasterIdLst", NS.pml));
    presentation.root.children.unshift(list);
    masterLists = [list];
  }
  for (const registration of registrations) {
    mainRels.items.push({
      id: registration.relId,
      type: REL_TYPES.slideMaster,
      target: names.get(registration.sourceName.toLowerCase())!,
      targetMode: "Internal",
    });
    for (const list of masterLists)
      list.children.push(
        elem(qname("p", "sldMasterId", NS.pml), {
          attrs: [
            attr(ID, String(registration.id)),
            attr(R_ID, registration.relId),
          ],
        }),
      );
  }
  target.setRels(main.name, mainRels);
  main.data = encode(serializeXml(presentation));
  return roots.map((name, index) => ({
    [LAYOUT_PART_NAME]: names.get(name.toLowerCase())!,
    [LAYOUT_PART]: layoutModels[index]!,
  }));
};

/** Copy one slide's native template; see importSlideTemplates for batch reuse. */
export const importSlideTemplate = (
  targetPres: PresentationData,
  sourceSlide: SlideData,
): SlideLayoutData => importSlideTemplates(targetPres, [sourceSlide])[0]!;
