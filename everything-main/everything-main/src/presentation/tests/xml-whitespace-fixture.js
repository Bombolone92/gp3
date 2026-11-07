import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P } from "../src/model.js";
import { chartLegendLayoutDeck, chartRoot } from "./chart-copy-fixture.js";

export async function chartXmlWhitespaceDeck(newline = "\r\n") {
  const names = ["Revenue\n北", "Cost\nWest", "Net\nSouth"],
    categories = ["Q1\nEast", "Q2\nWest"],
    f = chartLegendLayoutDeck({
      sizePt: 18,
      categories,
      categoryAxisLabelStyle: { font: "Arial", sizePt: 9 },
      valueAxisLabelStyle: { font: "Arial", sizePt: 9 },
      series: names.map((name, i) => ({
        name,
        values: [2 + i, 4 - i],
        color: ["#E85239", "#2F8541", "#376CA8"][i],
      })),
    }),
    files = unzipSync(await P.savePresentation(f.p)),
    part = chartRoot(f.shape).slice(1);
  // Writers can use physical CRLF in chart caches but LF in workbook cells.
  // Change lexical spelling only, leaving the authored workbook untouched.
  files[part] = strToU8(strFromU8(files[part]).replaceAll("\n", newline));
  return { bytes: zipSync(files), names, categories };
}
