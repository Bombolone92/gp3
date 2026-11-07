import {
  type PartName,
  type Relationship,
  type Relationships,
  nextRelId,
  partName,
  resolveTarget,
  relsPartNameFor,
} from "../../internal/opc/index.ts";
import type { OpcPackage } from "../../internal/parts/index.ts";
import {
  copyPartGraph,
  reservedPartNames,
} from "../../internal/parts/copy-graph.ts";
import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  parseXml,
  qname,
  serializeXml,
  walkElements,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_SLIDE,
  type SlideData,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { createTextFieldCopy, type TextFieldCopy } from "./text-field-copy.ts";
import { themeForSlide } from "./shape-theme.ts";
import { resolveChartPartName } from "./charts.ts";
import {
  themeBlocks,
  themeForChartPart,
  colorMapForChart,
  schemes,
  type Scheme,
  type ThemeBlock,
} from "./chart-theme.ts";

const THEME_OVERRIDE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride";
const THEME_OVERRIDE_TYPE =
  "application/vnd.openxmlformats-officedocument.themeOverride+xml";
type ChartCopyOptions = {
  sourceSlide: SlideData;
  preserveTextFormatting?: boolean;
  preservePaintFormatting?: boolean;
};
const child = (root: XmlElement, name: string) =>
  firstChildElement(root, qname("a", name, NS.dml));
const clone = (root: XmlElement): XmlElement => structuredClone(root);
/** @internal The chart's own native override participates in preview palette resolution. */
export const themeForChart = (shape: SlideShapeData) => {
  const slide = shape[SHAPE_SLIDE],
    resolved = resolveChartPartName(slide, shape);
  return resolved
    ? themeForChartPart(slide, resolved.partName)
    : themeForSlide(slide);
};

/** Copy native chart graphs without reconstructing ChartML or embedded workbooks. */
export const copyChartRelationships = (
  source: OpcPackage,
  owner: PartName,
  sourceRels: Relationships,
  target: OpcPackage,
  mapId: (id: string) => string,
  selectedIds?: ReadonlySet<string>,
  options?: ChartCopyOptions,
  fieldCopy: TextFieldCopy = createTextFieldCopy(target),
): ReadonlyMap<string, Relationship> | null => {
  const selected = sourceRels.items.filter(
    (r) =>
      r.type === REL_TYPES.chart && (!selectedIds || selectedIds.has(r.id)),
  );
  if (!selected.length) return null;
  const formatting = new Map<string, Map<Scheme, ThemeBlock>>();
  const roots = selected
    .filter((r) => r.targetMode === "Internal")
    .map((r) => resolveTarget(owner, r.target));
  const preserve =
    options &&
    (options.preserveTextFormatting === true ||
      options.preservePaintFormatting === true);
  if (preserve)
    for (const name of [...roots]) {
      const blocks = themeBlocks(options.sourceSlide, name);
      const wanted = new Map(
        [...blocks].filter(([key]) =>
          key === "fontScheme"
            ? options.preserveTextFormatting === true
            : options.preservePaintFormatting === true,
        ),
      );
      formatting.set(name.toLowerCase(), wanted);
      for (const { element, owner: themeOwner } of wanted.values())
        walkElements(element, (el) => {
          for (const a of el.attrs)
            if (a.name.namespaceURI === NS.officeDocRels) {
              const rel = source
                .getRels(themeOwner)
                ?.items.find((r) => r.id === a.value);
              if (rel?.targetMode === "Internal")
                roots.push(resolveTarget(themeOwner, rel.target));
            }
        });
    }
  const names = copyPartGraph(source, target, roots, fieldCopy.bytes);
  const copied = new Map(
    selected.map((rel) => [
      rel.id,
      {
        ...rel,
        id: mapId(rel.id),
        target:
          rel.targetMode === "External"
            ? rel.target
            : names.get(resolveTarget(owner, rel.target).toLowerCase())!,
      },
    ]),
  );
  for (const [sourceName, blocks] of formatting) {
    if (!blocks.size) continue;
    const original = source.getPart(partName(sourceName))!,
      chartName = names.get(sourceName)!;
    const rels = target.getRels(chartName) ?? { items: [] };
    const existing = rels.items.find(
      (r) => r.type === THEME_OVERRIDE && r.targetMode === "Internal",
    );
    let overridePart =
      existing && target.getPart(resolveTarget(chartName, existing.target));
    let doc: ReturnType<typeof parseXml>;
    try {
      doc = overridePart
        ? parseXml(new TextDecoder().decode(overridePart.data))
        : parseXml(
            `<a:themeOverride xmlns:a="${NS.dml}" xmlns:r="${NS.officeDocRels}"/>`,
          );
    } catch {
      continue;
    } // Preserve the copied optional payload instead of repairing unrelated XML.
    if (
      doc.root.name.namespaceURI !== NS.dml ||
      doc.root.name.localName !== "themeOverride"
    )
      continue; // Opaque malformed authored data.
    if (!overridePart) {
      const occupied = reservedPartNames(target);
      let n = 1,
        name: PartName;
      do {
        name = partName(`/ppt/theme/themeOverride${n++}.xml`);
      } while (
        occupied.has(name.toLowerCase()) ||
        occupied.has(relsPartNameFor(name).toLowerCase())
      );
      target.addPart(name, THEME_OVERRIDE_TYPE, new Uint8Array());
      overridePart = target.getPart(name)!;
      rels.items.push({
        id: nextRelId(rels.items.map((r) => r.id)),
        type: THEME_OVERRIDE,
        target: name,
        targetMode: "Internal",
      });
    }
    const overrideRels = target.getRels(overridePart.name) ?? { items: [] };
    const refs = new Map<string, string>();
    for (const [scheme, { element, owner: themeOwner }] of blocks) {
      const copiedBlock = clone(element);
      walkElements(copiedBlock, (el) => {
        el.attrs = el.attrs.map((a) => {
          if (a.name.namespaceURI !== NS.officeDocRels) return a;
          const key = `${themeOwner.toLowerCase()}\n${a.value}`;
          let id = refs.get(key);
          if (!id) {
            const rel = source
              .getRels(themeOwner)
              ?.items.find((r) => r.id === a.value);
            if (!rel) return a;
            id = nextRelId(overrideRels.items.map((r) => r.id));
            refs.set(key, id);
            overrideRels.items.push({
              ...rel,
              id,
              target:
                rel.targetMode === "External"
                  ? rel.target
                  : names.get(
                      resolveTarget(themeOwner, rel.target).toLowerCase(),
                    )!,
            });
          }
          return { ...a, value: id };
        });
      });
      const previous = child(doc.root, scheme);
      if (previous)
        doc.root.children[doc.root.children.indexOf(previous)] = copiedBlock;
      else {
        const later = doc.root.children.findIndex(
          (c) =>
            c.kind === "element" &&
            c.name.namespaceURI === NS.dml &&
            (schemes.indexOf(c.name.localName as Scheme) >
              schemes.indexOf(scheme) ||
              c.name.localName === "extLst"),
        );
        if (later < 0) doc.root.children.push(copiedBlock);
        else doc.root.children.splice(later, 0, copiedBlock);
      }
    }
    overridePart.data = new TextEncoder().encode(serializeXml(doc));
    if (overrideRels.items.length)
      target.setRels(overridePart.name, overrideRels);
    target.setRels(chartName, rels);
    // ISO 29500 c:clrMapOvr explicitly preserves the application mapping
    // for Keep Source Formatting. It precedes pivotSource/protection/chart.
    if (options?.preservePaintFormatting === true) {
      const chartDoc = parseXml(
        new TextDecoder().decode(target.getPart(chartName)!.data),
      );
      const originalRoot = readOnlyPartRoot(original);
      const mapping = colorMapForChart(options.sourceSlide, originalRoot);
      let local = firstChildElement(
        chartDoc.root,
        qname("c", "clrMapOvr", NS.chart),
      );
      if (!local) {
        local = elem(qname("c", "clrMapOvr", NS.chart));
        const before = chartDoc.root.children.findIndex(
          (c) =>
            c.kind === "element" &&
            c.name.namespaceURI === NS.chart &&
            [
              "pivotSource",
              "protection",
              "chart",
              "spPr",
              "txPr",
              "externalData",
              "printSettings",
              "userShapes",
              "extLst",
            ].includes(c.name.localName),
        );
        if (before < 0) chartDoc.root.children.push(local);
        else chartDoc.root.children.splice(before, 0, local);
      }
      for (const [key, value] of Object.entries(mapping))
        if (
          !local.attrs.some(
            (a) => a.name.namespaceURI === "" && a.name.localName === key,
          )
        )
          local.attrs.push(attr(qname("", key, ""), value));
      target.getPart(chartName)!.data = new TextEncoder().encode(
        serializeXml(chartDoc),
      );
    }
  }
  return copied;
};
