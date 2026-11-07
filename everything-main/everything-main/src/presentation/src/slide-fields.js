import * as P from "../lib/pptx/src/index.ts";
import { SLIDE_DOCUMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { readOnlyPartRoot } from "../lib/pptx/src/internal/parts/read-only-xml.ts";
import {
  NS,
  firstChildElement,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const fieldCache = new WeakMap();
const decoder = new TextDecoder();
const shapeNames = new Set(["sp", "pic", "cxnSp"]);
const skipped = new Set(["spPr", "grpSpPr", "blipFill", "extLst"]);
const fieldType = qname("", "type", "");
const phName = qname("p", "ph", NS.pml);

function fieldKinds(part, slideRoot) {
  if (!part) return 0;
  const cached = fieldCache.get(part);
  if (cached?.data === part.data && cached.slideRoot === slideRoot)
    return cached.kinds;
  // Conservative prefilter only; namespace-aware XML owns the decision.
  let kinds = 0;
  if (slideRoot || /slidenum|datetime|&#/.test(decoder.decode(part.data))) {
    const root = slideRoot || readOnlyPartRoot(part);
    const template = root.name.localName !== "sld";
    const visit = (node) => {
      if (node.name.namespaceURI === NS.dml && node.name.localName === "fld") {
        const type = getAttrValue(node, fieldType);
        if (type === "slidenum") return 1;
        return /^(datetime(?:[1-9]|1[0-3]|FigureOut)?|uaqdatetime[1-7])$/.test(
          type ?? "",
        )
          ? 2
          : 0;
      }
      if (node.name.namespaceURI === NS.pml) {
        if (skipped.has(node.name.localName)) return 0;
        // Template placeholders are rendered through slide instances, not as
        // decorations. Counting them would invalidate every ordinary slide.
        if (template && shapeNames.has(node.name.localName)) {
          for (const nv of node.children) {
            if (
              nv.kind !== "element" ||
              nv.name.namespaceURI !== NS.pml ||
              !nv.name.localName.startsWith("nv")
            )
              continue;
            const props = firstChildElement(nv, qname("p", "nvPr", NS.pml));
            if (props && firstChildElement(props, phName)) return 0;
          }
        }
      }
      let found = 0;
      for (const child of node.children) {
        if (child.kind === "element") found |= visit(child);
        if (found === 3) break;
      }
      return found;
    };
    kinds = visit(root);
  }
  fieldCache.set(part, { data: part.data, slideRoot, kinds });
  return kinds;
}

// Slide order and the opening/presentation/print date live outside slide XML.
// Only dependent slides need a new preview when these values change.
function slideFieldKinds(pres, slide) {
  const pkg = P._internalPackageOf(pres);
  let name = P.getSlidePartName(slide);
  let kinds = fieldKinds(pkg.getPart(name), slide[SLIDE_DOCUMENT].root);
  for (const type of [REL_TYPES.slideLayout, REL_TYPES.slideMaster]) {
    if (kinds === 3) break;
    const rel = pkg.getRels(name)?.items.find((r) => r.type === type);
    if (!rel) break;
    name = resolveTarget(name, rel.target);
    kinds |= fieldKinds(pkg.getPart(name));
  }
  return kinds;
}
export function slideNumberStamp(pres, slide) {
  return slideFieldKinds(pres, slide) & 1
    ? P.getSlideNumber(pres, slide)
    : null;
}
export function slideHasDateFields(pres, slide) {
  return Boolean(slideFieldKinds(pres, slide) & 2);
}
export function slideFieldStamp(pres, slide) {
  const kinds = slideFieldKinds(pres, slide);
  if (!kinds) return null;
  return `${kinds & 1 ? P.getSlideNumber(pres, slide) : ""}/${kinds & 2 ? P.getPresentationFieldDate(pres).getTime() : ""}`;
}
