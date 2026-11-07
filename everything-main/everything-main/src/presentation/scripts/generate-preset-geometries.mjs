// Rebuild the Apache-licensed canonical DrawingML presets from a pinned source.
// Usage: node scripts/generate-preset-geometries.mjs [local-source.xml]
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
import {
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";

const source =
  "https://raw.githubusercontent.com/apache/poi/338882ac8898df5c13a7d15f533204c5dd8607d6/poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml";
const sha256 =
  "4a762444d8d85876881c02a5b1dedf6f73006fcd8acb7b4e393435615b37c780";
const xml = process.argv[2]
  ? await readFile(process.argv[2], "utf8")
  : await (await fetch(source)).text();
if (createHash("sha256").update(xml).digest("hex") !== sha256)
  throw new Error("Preset source checksum mismatch");
const definitions = parseXml(xml).root.children.filter(
  (c) => c.kind === "element",
);
if (definitions.length !== 187) throw new Error("Unexpected preset count");
const compact = (element) => {
  element.children = element.children.filter(
    (c) => c.kind !== "text" || c.data.trim(),
  );
  for (const child of element.children)
    if (child.kind === "element") compact(child);
  return element;
};
const entries = definitions.map(
  (el) =>
    `  ${JSON.stringify(el.name.localName)}: ${JSON.stringify(serializeFragment(compact(el)))},`,
);
await writeFile(
  new URL(
    "../lib/pptx/src/internal/drawingml/preset-definitions.ts",
    import.meta.url,
  ),
  await format(
    `// SPDX-License-Identifier: Apache-2.0\n// Apache POI canonical DrawingML geometry definitions.\n// Copyright 2003-2025 The Apache Software Foundation.\n// Source: ${source}\n// SHA-256: ${sha256}\n// Modified: indexed by preset name; removed whitespace-only text and XML declaration.\n// Regenerate: node scripts/generate-preset-geometries.mjs\n// License and attribution: public/licenses/Apache-2.0.txt, public/THIRD_PARTY_NOTICES.txt\nexport const PRESET_DEFINITIONS: Readonly<Record<string, string>> = {\n${entries.join("\n")}\n};\n`,
    { parser: "typescript" },
  ),
);
