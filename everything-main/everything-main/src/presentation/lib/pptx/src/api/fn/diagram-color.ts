import type { DiagramColorSample } from "../../internal/diagram/color-list.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  qname,
} from "../../internal/xml/index.ts";
import {
  resolveDrawingColor,
  resolveDrawingColorRgb,
  resolveDrawingOpacity,
  rgbToHsl,
} from "./shape-color.ts";
import type { PresentationTheme } from "./theme.ts";

/** Resolve a sampled palette only for a private display projection. */
export const expandDiagramColor = (
  sample: DiagramColorSample,
  theme: PresentationTheme | null,
  colorMap?: Readonly<Record<string, string>> | null,
): XmlElement | null => {
  const { from, to, amount } = sample;
  // Repeat and the start of an interval retain authored color XML.
  if (amount === 0 || from === to) return from;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) return null;
  const first = resolveDrawingColorRgb(from, theme, colorMap);
  const last = resolveDrawingColorRgb(to, theme, colorMap);
  if (!first || !last) return null;
  const start = rgbToHsl(...first);
  const end = rgbToHsl(...last);
  // Native SmartArt expands a palette entry into the interval's starting
  // color followed by hueOff, satOff, lumOff and alphaOff, in that order.
  // This is observably different from constructing one interpolated HSL color:
  // each operation converts through RGB, so achromatic input loses hue before
  // saturation is applied. Even amount=1 must execute the interval's transforms.
  // Numeric hue offsets do not wrap to the shorter arc. hueDir is
  // ignored for span/cycle (Open Specifications support answer, 2026-06-19):
  // https://learn.microsoft.com/en-au/answers/questions/5905698/
  const result = structuredClone(from);
  const offsets = [
    ["hueOff", (end[0] - start[0]) * 21600000],
    ["satOff", (end[1] - start[1]) * 100000],
    ["lumOff", (end[2] - start[2]) * 100000],
    [
      "alphaOff",
      (resolveDrawingOpacity(to) - resolveDrawingOpacity(from)) * 100000,
    ],
  ] as const;
  for (const [name, difference] of offsets)
    result.children.push(
      elem(qname("a", name, NS.dml), {
        attrs: [
          attr(qname("", "val", ""), String(Math.round(difference * amount))),
        ],
      }),
    );
  return result;
};

/** Text colors are resolved after interpolation. Shape style matrices instead
 * use expandDiagramColor so theme transforms run after the palette transforms
 * without rounding an intermediate color to eight-bit RGB.
 */
export const resolveDiagramColor = (
  sample: DiagramColorSample,
  theme: PresentationTheme | null,
  colorMap?: Readonly<Record<string, string>> | null,
): XmlElement | null => {
  const result = expandDiagramColor(sample, theme, colorMap);
  if (!result || sample.amount === 0 || sample.from === sample.to)
    return result;
  // The materialized text is read in the projection's context, which can have
  // a different color map. Resolve here with the diagram owner's map; authored
  // palette/theme XML in the package is never changed.
  const resolved = resolveDrawingColor(result, theme, colorMap);
  if (!resolved) return null;
  const opacity = resolveDrawingOpacity(result);
  return elem(qname("a", "srgbClr", NS.dml), {
    attrs: [attr(qname("", "val", ""), resolved.slice(1))],
    children:
      opacity === 1
        ? []
        : [
            elem(qname("a", "alpha", NS.dml), {
              attrs: [
                attr(
                  qname("", "val", ""),
                  String(Math.round(opacity * 100000)),
                ),
              ],
            }),
          ],
  });
};
