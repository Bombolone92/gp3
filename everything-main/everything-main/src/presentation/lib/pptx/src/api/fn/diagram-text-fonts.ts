import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import type { DiagramStyle } from "../../internal/diagram/styles.ts";
import type { DiagramTextPropertyLayer as Layer } from "./diagram-text-properties.ts";
import type { PresentationTheme } from "./theme.ts";
import type { PartName } from "../../internal/opc/index.ts";
import { resolveDiagramColor } from "./diagram-color.ts";

const child = (el: XmlElement | null, name: string, ns: string = NS.dml) =>
  el && firstChildElement(el, qname("", name, ns));
const value = (el: XmlElement, name: string) =>
  getAttrValue(el, qname("", name, ""));

/** Font reference and palette defaults shared by semantic and saved projections.
 * Returned layers retain part provenance; the paragraph merger clones them.
 * Resolving an interpolated palette is the only operation requiring a theme.
 */
export const diagramTextFontLayers = (
  style: Pick<DiagramStyle, "quickStyle" | "textFill">,
  options: {
    quickOwner: PartName;
    colorOwner: PartName;
    fontOverride?: Layer | null;
    theme: () => PresentationTheme | null;
    colorMap: Readonly<Record<string, string>> | null;
    report: (message: string) => void;
  },
): Layer[] => {
  // An existing but empty quick-style label gets the major font (native
  // reference). A saved drawing's explicit font reference still takes
  // precedence.
  const quickFont =
    child(child(style.quickStyle, "style", NS.diagram), "fontRef") ??
    (style.quickStyle
      ? elem(qname("a", "fontRef", NS.dml), {
          attrs: [attr(qname("", "idx", ""), "major")],
        })
      : null);
  const savedFont = options.fontOverride?.element;
  const quickOwner = options.quickOwner;
  const drawingOwner = options.fontOverride?.owner ?? quickOwner;
  const defaults: Layer[] = [];
  const font = savedFont ?? quickFont;
  if (font) {
    const owner = savedFont ? drawingOwner : quickOwner;
    const rPr = elem(qname("a", "defRPr", NS.dml));
    const index = value(font, "idx");
    if (index === "major" || index === "minor") {
      const prefix = index === "major" ? "+mj" : "+mn";
      for (const [name, suffix] of [
        ["latin", "lt"],
        ["ea", "ea"],
        ["cs", "cs"],
      ])
        rPr.children.push(
          elem(qname("a", name!, NS.dml), {
            attrs: [attr(qname("", "typeface", ""), `${prefix}-${suffix}`)],
          }),
        );
    }
    const color = font.children.filter(
      (el): el is XmlElement =>
        el.kind === "element" &&
        el.name.namespaceURI === NS.dml &&
        [
          "srgbClr",
          "scrgbClr",
          "hslClr",
          "schemeClr",
          "sysClr",
          "prstClr",
        ].includes(el.name.localName),
    )[0];
    if (color)
      rPr.children.unshift(
        elem(qname("a", "solidFill", NS.dml), { children: [color] }),
      );
    defaults.push({
      element: elem(qname("a", "pPr", NS.dml), { children: [rPr] }),
      owner,
    });
  }
  const sample = style.textFill;
  if (sample) {
    const theme =
      sample.amount !== 0 && sample.from !== sample.to ? options.theme() : null;
    const color = resolveDiagramColor(sample, theme, options.colorMap);
    if (!color) options.report("text palette contains an unresolved color");
    else
      defaults.push({
        element: elem(qname("a", "pPr", NS.dml), {
          children: [
            elem(qname("a", "defRPr", NS.dml), {
              children: [
                elem(qname("a", "solidFill", NS.dml), { children: [color] }),
              ],
            }),
          ],
        }),
        owner: options.colorOwner,
      });
  }
  return defaults;
};
