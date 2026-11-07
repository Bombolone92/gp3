import { P, createDeck } from "../src/model.js";
import { chartRoot } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
export const inversionColors = ["#E85239", "#316BB0"];
export function chartInversionDeck({
  kind = "bar",
  grouping = "clustered",
  inversion,
  crossing = "autoZero",
  orientation = "minMax",
  negativeColor,
  pointInvertIfNegative,
  pointColors,
  ...options
} = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const shape = P.addSlideChart(slide, {
    x: P.pt(54),
    y: P.pt(54),
    w: P.pt(648),
    h: P.pt(360),
    spec: {
      kind,
      grouping,
      categories: ["A", "B", "C", "D"],
      series: (kind === "pie"
        ? [[-4, -1, 2, 5]]
        : [
            [-4, -1, 2, 5],
            [-2, 3, 4, -1],
          ]
      ).map((values, i) => ({
        name: `Series ${i}`,
        values,
        color: inversionColors[i],
        ...(inversion === undefined ? {} : { invertIfNegative: inversion }),
        ...(negativeColor === undefined ? {} : { negativeColor }),
        ...(pointInvertIfNegative === undefined
          ? {}
          : { pointInvertIfNegative }),
        ...(pointColors === undefined ? {} : { pointColors }),
      })),
      categoryAxisCrosses: crossing,
      valueAxisOrientation: orientation,
      valueAxis: { min: -8, max: 8, majorUnit: 4 },
      categoryAxisLabelRotationDeg: 0,
      valueAxisLabelRotationDeg: 0,
      valueAxisMajorGridlines: false,
      plotAreaFill: "#ECF5E9",
      plotAreaStrokeColor: null,
      chartAreaFill: "#F4F0E8",
      chartAreaStrokeColor: null,
      ...options,
    },
  });
  return { p, slide, shape };
}
// Seed extension XML independently of the writer under test, including a theme
// color and opaque metadata to detect destructive edits.
export function nativeInvertedColor(f, paint = '<a:srgbClr val="61A8B4"/>') {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
  const doc = parseXml(new TextDecoder().decode(part.data));
  const child = (e, n) => firstChildElement(e, qname("c", n, NS.chart));
  const group = child(child(child(doc.root, "chart"), "plotArea"), "barChart");
  for (const ser of group.children.filter(
    (e) => e.kind === "element" && e.name.localName === "ser",
  )) {
    ser.children.push(
      parseXml(
        `<c:extLst xmlns:c="${NS.chart}" xmlns:a="${NS.dml}" xmlns:i="http://schemas.microsoft.com/office/drawing/2007/8/2/chart" xmlns:u="urn:chart-inversion-test"><c:ext uri="{6F2FDCE9-48DA-4B69-8628-5D25D57E5C99}"><i:invertSolidFillFmt><i:spPr><a:solidFill>${paint}</a:solidFill><u:opaque flag="retain"/></i:spPr></i:invertSolidFillFmt></c:ext><c:ext uri="urn:unrelated"><u:keep/></c:ext></c:extLst>`,
      ).root,
    );
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
}
