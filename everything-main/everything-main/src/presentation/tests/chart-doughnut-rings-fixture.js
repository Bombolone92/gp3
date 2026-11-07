import { P } from "../src/model.js";
import { chartDoughnutExtentsDeck } from "./chart-cache-availability-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import {
  NS,
  firstChildElement,
  allChildElements,
  parseXml,
  qname,
  serializeXml,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

export const ringColors = [
  "#E85239",
  "#2F8541",
  "#376CA8",
  "#B6327E",
  "#B89613",
];
const child = (e, n) => firstChildElement(e, qname("c", n, NS.chart));

// Native import fixture, independent of the multi-series authoring path.
export function nativeDoughnutRingsDeck({
  values = [
    [2, 4, 3],
    [3, 2, 1],
  ],
  hole = 50,
  angle = 0,
  explosions = [],
  labels = [],
} = {}) {
  const f = chartDoughnutExtentsDeck(values),
    part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    group = child(child(child(doc.root, "chart"), "plotArea"), "doughnutChart");
  group.children = group.children.filter(
    (e) =>
      e !== child(group, "holeSize") && e !== child(group, "firstSliceAng"),
  );
  if (angle !== undefined)
    group.children.push(
      parseXml(`<c:firstSliceAng xmlns:c="${NS.chart}" val="${angle}"/>`).root,
    );
  if (hole !== null)
    group.children.push(
      parseXml(`<c:holeSize xmlns:c="${NS.chart}" val="${hole}"/>`).root,
    );
  for (const [i, ser] of allChildElements(
    group,
    qname("c", "ser", NS.chart),
  ).entries()) {
    for (const dpt of allChildElements(ser, qname("c", "dPt", NS.chart))) {
      walkElements(child(dpt, "spPr"), (e) => {
        if (e.name.localName === "srgbClr")
          e.attrs[0].value = ringColors[i].slice(1);
      });
      if (explosions[i])
        dpt.children.splice(
          2,
          0,
          parseXml(
            `<c:explosion xmlns:c="${NS.chart}" val="${explosions[i]}"/>`,
          ).root,
        );
    }
    // Source labels explicitly spell out false flags so native omissions do not
    // introduce independent reader defaults for series names or legend keys.
    if (labels[i]) {
      const l = labels[i];
      ser.children.splice(
        ser.children.indexOf(child(ser, "cat")),
        0,
        parseXml(
          `<c:dLbls xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"><a:solidFill><a:srgbClr val="${(l.color ?? "#101010").slice(1)}"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="${l.showValue ? 1 : 0}"/><c:showCatName val="${l.showCategory ? 1 : 0}"/><c:showSerName val="${l.showSeriesName ? 1 : 0}"/><c:showPercent val="${l.showPercent ? 1 : 0}"/><c:showBubbleSize val="0"/><c:separator> | </c:separator></c:dLbls>`,
        ).root,
      );
    }
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
