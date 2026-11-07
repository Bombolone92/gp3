import {
  _internalPackageOf,
  getSlideLayoutPartName,
  getSlideLayoutShapes,
  getSlideMasterShapes,
  getSlidePartName,
  type PresentationData,
  type SlideData,
  type SlideLayoutData,
  type SlideShapeData,
} from "../../pptx/src/index.ts";
import { partName, resolveTarget } from "../../pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../../pptx/src/internal/presentationml/index.ts";
import { readOnlyPartRoot } from "../../pptx/src/internal/parts/read-only-xml.ts";
import { getAttrValue, qname } from "../../pptx/src/internal/xml/index.ts";

// Keep the renderer's independent decoration handles private. Public template
// readers still return fresh trees, so callers cannot mutate these cached
// handles. Paint, text, media and relationship resolution remain live reads;
// only the parsed shape tree is reused. Weak keys release closed presentations.
const cache = new WeakMap<
  PresentationData,
  WeakMap<object, { bytes: Uint8Array; shapes: readonly SlideShapeData[] }>
>();

export const templateShapes = (
  pres: PresentationData,
  layout: SlideLayoutData,
  slide: SlideData,
): { master: readonly SlideShapeData[]; layout: readonly SlideShapeData[] } => {
  let parts = cache.get(pres);
  if (!parts) cache.set(pres, (parts = new WeakMap()));
  const pkg = _internalPackageOf(pres);
  const layoutName = partName(getSlideLayoutPartName(layout));
  const showsMasterShapes = (name: string): boolean => {
    const part = pkg.getPart(partName(name));
    if (!part) return true;
    const value = getAttrValue(
      readOnlyPartRoot(part),
      qname("", "showMasterSp", ""),
    )?.trim();
    return value !== "0" && value !== "false";
  };
  // The slide's flag hides both template layers; the layout flag
  // hides only master artwork. Neither affects backgrounds or the slide's
  // placeholder inheritance. Filter each live view, never the cached trees.
  if (!showsMasterShapes(getSlidePartName(slide)))
    return { master: [], layout: [] };
  const masterRel = pkg
    .getRels(layoutName)
    ?.items.find((rel) => rel.type === REL_TYPES.slideMaster);
  const read = (
    name: string | null,
    load: () => readonly SlideShapeData[],
  ): readonly SlideShapeData[] => {
    const part = name === null ? null : pkg.getPart(partName(name));
    if (!part) return [];
    const hit = parts.get(part);
    if (hit?.bytes === part.data) return hit.shapes;
    const shapes = load();
    parts.set(part, { bytes: part.data, shapes });
    return shapes;
  };
  // Resolve both relationships on each render, before consulting the cache.
  return {
    master: showsMasterShapes(layoutName)
      ? read(
          masterRel ? resolveTarget(layoutName, masterRel.target) : null,
          () => getSlideMasterShapes(pres, layout),
        )
      : [],
    layout: read(layoutName, () => getSlideLayoutShapes(pres, layout)),
  };
};
