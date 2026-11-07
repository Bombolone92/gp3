// Canonical preset geometry shares the custom-geometry guide/path evaluator.
// Definitions are parsed lazily once; evaluated models never share mutable data.
import { parseXml, type XmlElement } from "../xml/index.ts";
import { parseCustomGeometry, type CustomGeometry } from "./custom-geometry.ts";
import { PRESET_DEFINITIONS } from "./preset-definitions.ts";

const definitions = new Map<string, XmlElement>();

export const parsePresetGeometry = (
  preset: string,
  w: number,
  h: number,
  adjustments: XmlElement | null = null,
): CustomGeometry | null => {
  // Keep the two legacy names accepted by the previous renderer. Their raw
  // authored names remain untouched; use the equivalent standard definitions.
  if (preset === "oval") preset = "ellipse";
  else if (preset === "flowChartCard") preset = "flowChartPunchedCard";
  if (!Object.hasOwn(PRESET_DEFINITIONS, preset)) return null;
  let definition = definitions.get(preset);
  if (!definition) {
    definition = parseXml(PRESET_DEFINITIONS[preset]!).root;
    definitions.set(preset, definition);
  }
  return parseCustomGeometry(definition, w, h, adjustments);
};
