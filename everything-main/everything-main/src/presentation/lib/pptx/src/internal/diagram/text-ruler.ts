import type { DiagramTextParagraph } from "./text-content.ts";
import type { DiagramPoint } from "./data-model.ts";
import {
  DEFAULT_DIAGRAM_TEXT_FONT_SIZE,
  hasDiagramPointTextFontSizes,
  readDiagramPointTextFontSize,
} from "./text-customization.ts";

/**
 * Native-reference diagram ruler defaults, in EMU. These are not proportional
 * bullet indents: font bands below 12/16/20/28 points select 1/16 through 5/16
 * inch increments. Independent native controls cover fractional boundaries,
 * 1..4000 pt, different fonts, dimensions, hierarchy and custom/noncustom text.
 * This compatibility rule applies to TX defaults, not ordinary DrawingML text.
 *
 * Customized text uses each contributing POINT's first character for every
 * paragraph's ruler, not each paragraph's first/largest run and not the first
 * customized point of the whole shape. A completely unsized point receives
 * the diagram default. Otherwise a missing first size uses that paragraph's
 * algorithm font role, ignoring point list/pPr font declarations.
 * For ordinary text, authored font sizes have no effect on the ruler.
 */
export const resolveDiagramTextRuler = (
  paragraph: DiagramTextParagraph,
  custom: boolean,
  fontSize: (role: "primary" | "secondary") => number,
  /** Optional per-projection cache; never reuse across semantic edits. */
  firstFonts?: WeakMap<DiagramPoint, number | null>,
) => {
  let direct: number | null = null;
  if (custom) {
    const point = paragraph.source.point;
    const cached = firstFonts?.get(point);
    direct =
      cached !== undefined
        ? cached
        : hasDiagramPointTextFontSizes(point)
          ? readDiagramPointTextFontSize(point)
          : DEFAULT_DIAGRAM_TEXT_FONT_SIZE;
    firstFonts?.set(point, direct);
  }
  const font = direct ?? fontSize(paragraph.font);
  if (!Number.isFinite(font) || font < 0 || font > 4000)
    throw new Error("invalid diagram ruler font size");
  const level = paragraph.hierarchyLevel;
  if (!Number.isSafeInteger(level) || level < 0)
    throw new Error("invalid diagram ruler hierarchy level");
  const step =
    (font < 12 ? 1 : font < 16 ? 2 : font < 20 ? 3 : font < 28 ? 4 : 5) *
    (914400 / 16);
  return {
    marginLeft: level * step,
    indent: level === 0 ? 0 : -step,
    // Convert the font height to EMU before applying the 3.5-height tab ruler,
    // then truncate. Native fractional-size controls distinguish this order
    // from multiplying in points first (a one-EMU difference at boundaries).
    defaultTabSize: Math.trunc(Math.max(1, font) * 12700 * 3.5),
  };
};
