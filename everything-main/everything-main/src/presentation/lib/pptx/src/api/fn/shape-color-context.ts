import type { XmlElement } from "../../internal/xml/index.ts";
import {
  SHAPE_SLIDE,
  type PresentationData,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import { resolveDrawingColor } from "./shape-color.ts";
import { getPresentationTheme } from "./theme.ts";
import { themeForShape } from "./shape-theme.ts";

// Resolve in the owning slide's context unless a renderer supplies the host
// slide's map for a template decoration. Literal colors need no map lookup.
export const resolveShapeColor = (
  pres: PresentationData,
  shape: SlideShapeData,
  color: XmlElement,
  colorMap?: Readonly<Record<string, string>> | null,
): string | null =>
  resolveDrawingColor(
    color,
    themeForShape(shape)?.theme ?? getPresentationTheme(pres),
    color.name.localName === "schemeClr"
      ? (colorMap ?? getEffectiveColorMap(shape[SHAPE_SLIDE]))
      : undefined,
  );
