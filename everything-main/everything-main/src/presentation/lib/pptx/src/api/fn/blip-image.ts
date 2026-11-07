import {
  detectImageFormat,
  resolveTarget,
  type PartName,
} from "../../internal/opc/index.ts";
import type { OpcPackage } from "../../internal/parts/index.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  NS,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
  type XmlElement,
  type XmlNode,
} from "../../internal/xml/index.ts";

/** The vector source precedes the main blip's raster compatibility image. */
export const blipImageReferences = (blip: XmlElement) => {
  const references: { element: XmlElement; id: string; svg: boolean }[] = [];
  const extensions = firstChildElement(blip, qname("a", "extLst", NS.dml));
  if (extensions)
    for (const extension of extensions.children) {
      if (
        extension.kind !== "element" ||
        extension.name.namespaceURI !== NS.dml ||
        extension.name.localName !== "ext"
      )
        continue;
      const svg = firstChildElement(
        extension,
        qname("asvg", "svgBlip", NS.asvg),
      );
      const id =
        svg && getAttrValue(svg, qname("r", "embed", NS.officeDocRels));
      if (svg && id) references.push({ element: svg, id, svg: true });
    }
  const id = getAttrValue(blip, qname("r", "embed", NS.officeDocRels));
  if (id) references.push({ element: blip, id, svg: false });
  return references;
};

/** Resolve locally only. A broken/foreign vector reference can use the PNG fallback. */
export const resolveBlipImage = (
  pkg: OpcPackage,
  owner: PartName,
  blip: XmlElement,
) => {
  const relationships = pkg.getRels(owner)?.items;
  for (const reference of blipImageReferences(blip)) {
    const relationship = relationships?.find((r) => r.id === reference.id);
    if (
      !relationship ||
      relationship.type !== REL_TYPES.image ||
      relationship.targetMode !== "Internal"
    )
      continue;
    const name = resolveTarget(owner, relationship.target);
    const part = pkg.getPart(name);
    if (!part || (reference.svg && detectImageFormat(part.data) !== "svg"))
      continue;
    return { ...reference, name, part };
  }
  return null;
};

/** Replacing the visible image must not leave a preferred source pointing at the old picture. */
export const removeSvgBlipReferences = (blip: XmlElement): void => {
  const extensions = firstChildElement(blip, qname("a", "extLst", NS.dml));
  if (!extensions) return;
  let changed = false;
  const retained = (child: XmlNode) =>
    child.kind !== "text" || child.data.trim() !== "";
  extensions.children = extensions.children.filter((extension) => {
    if (
      extension.kind !== "element" ||
      extension.name.namespaceURI !== NS.dml ||
      extension.name.localName !== "ext"
    )
      return true;
    if (!firstChildElement(extension, qname("asvg", "svgBlip", NS.asvg)))
      return true;
    changed = true;
    extension.children = extension.children.filter(
      (child) =>
        child.kind !== "element" ||
        child.name.namespaceURI !== NS.asvg ||
        child.name.localName !== "svgBlip",
    );
    return extension.children.some(retained);
  });
  if (changed && !extensions.children.some(retained))
    blip.children = blip.children.filter((child) => child !== extensions);
};

/** SVG's PNG compatibility image is optional, as in native-reference SVG-only saves. */
export const setBlipImageReference = (
  blip: XmlElement,
  id: string,
  svg: boolean,
): boolean => {
  const previousEmbed = blip.attrs.find(
    (a) =>
      a.name.namespaceURI === NS.officeDocRels && a.name.localName === "embed",
  );
  const refs = blipImageReferences(blip);
  const linked = getAttrValue(blip, qname("r", "link", NS.officeDocRels));
  if (
    !svg &&
    refs.length === 1 &&
    !refs[0]!.svg &&
    refs[0]!.id === id &&
    linked === null
  )
    return false;
  if (
    svg &&
    refs.length === 1 &&
    refs[0]!.svg &&
    refs[0]!.id === id &&
    previousEmbed === undefined &&
    linked === null &&
    getAttrValue(refs[0]!.element, qname("r", "link", NS.officeDocRels)) ===
      null
  )
    return false;
  removeSvgBlipReferences(blip);
  blip.attrs = blip.attrs.filter(
    (a) =>
      a.name.namespaceURI !== NS.officeDocRels ||
      (a.name.localName !== "embed" && a.name.localName !== "link"),
  );
  if (!svg) {
    blip.attrs.push(
      attr(previousEmbed?.name ?? qname("r", "embed", NS.officeDocRels), id),
    );
    return true;
  }
  let extensions = firstChildElement(blip, qname("a", "extLst", NS.dml));
  if (!extensions) {
    extensions = elem(qname("a", "extLst", NS.dml));
    blip.children.push(extensions);
  }
  extensions.children.push(
    elem(qname("a", "ext", NS.dml), {
      attrs: [
        attr(qname("", "uri", ""), "{96DAC541-7B7A-43D3-8B79-37D633B846F1}"),
      ],
      children: [
        elem(qname("asvg", "svgBlip", NS.asvg), {
          attrs: [attr(qname("r", "embed", NS.officeDocRels), id)],
        }),
      ],
    }),
  );
  return true;
};
