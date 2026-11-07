import type { OpcPackage, Part } from "../../internal/parts/index.ts";
import type { PartName } from "../../internal/opc/index.ts";
import { relsPartNameFor, resolveTarget } from "../../internal/opc/index.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_SLIDE,
  SLIDE_PART_NAME,
  type SlideShapeData,
  type SlideData,
} from "../_internal-symbols.ts";
import { readThemePart } from "./theme.ts";

// Store only the immutable relationship targets we need. A relationship edit
// replaces the part bytes; recheck both part and bytes before reusing targets.
const themeTargets = new WeakMap<
  Part,
  {
    data: Uint8Array;
    theme: string | undefined;
    parent: string | undefined;
  }
>();

// Follow the owning part's theme, including synthetic layout/master views.
// Relationship edits are observed on every call; cycles cannot recurse forever.
export const themeForShape = (shape: SlideShapeData) =>
  themeForSlide(shape[SHAPE_SLIDE]);

export const themeForSlide = (slide: SlideData) =>
  themeForPart(slide[INTERNAL_PACKAGE], slide[SLIDE_PART_NAME]);

/** @internal Shared owning-theme lookup for slides, layouts and masters. */
export const themeForPart = (pkg: OpcPackage, part: PartName) => {
  const seen = new Set<string>();
  while (!seen.has(part.toLowerCase())) {
    seen.add(part.toLowerCase());
    const relsPart = pkg.getPart(relsPartNameFor(part));
    let targets = relsPart && themeTargets.get(relsPart);
    if (relsPart && targets?.data !== relsPart.data) {
      const rels =
        pkg.getRels(part)?.items.filter((r) => r.targetMode !== "External") ??
        [];
      targets = {
        data: relsPart.data,
        theme: rels.find((r) => r.type === REL_TYPES.theme)?.target,
        parent: (
          rels.find((r) => r.type === REL_TYPES.slideLayout) ??
          rels.find((r) => r.type === REL_TYPES.slideMaster)
        )?.target,
      };
      themeTargets.set(relsPart, targets);
    }
    if (targets?.theme) {
      const target = pkg.getPart(resolveTarget(part, targets.theme));
      if (target) return readThemePart(target);
    }
    if (!targets?.parent) break;
    part = resolveTarget(part, targets.parent);
  }
  const fallback = pkg.parts
    .filter(
      (p) =>
        p.contentType ===
        "application/vnd.openxmlformats-officedocument.theme+xml",
    )
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return fallback ? readThemePart(fallback) : null;
};
