import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { P, parseDeck } from "../src/model.js";
import { createGeometryDeck, presetGeometry } from "./geometry-fixture.js";

export async function imagePaintFixture({
  level = "layout",
  effects = '<a:alphaModFix amt="25000"/><a:lum bright="10000" contrast="80000"/>',
  crop = '<a:srcRect l="10000" t="15000" r="20000" b="5000"/>',
  override = "",
  broken = false,
  external = false,
  svg = false,
} = {}) {
  const files = unzipSync(
    await createGeometryDeck({
      level: level === "master" ? "master" : "local",
      shapeKind: "shape",
      geometry: presetGeometry("rect"),
      directGeometry: presetGeometry("rect"),
    }),
  );
  const p = await parseDeck(zipSync(files)),
    s = P.getSlides(p)[0];
  const slide = P.getSlidePartName(s).slice(1);
  const host =
    level === "local"
      ? slide
      : level === "layout"
        ? P.getSlideLayoutPartName(P.getSlideLayout(s)).slice(1)
        : P.getSlideMasterPartName(s).slice(1);
  const rels = (n) => n.replace(/([^/]+)$/, "_rels/$1.rels");
  const sourceXml = strFromU8(files[slide]);
  const original = sourceXml.match(/<a:blipFill\b[\s\S]*?<\/a:blipFill>/)[0];
  const sourceRels = strFromU8(files[rels(slide)]);
  const target = sourceRels.match(
    /<Relationship\b[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/,
  )[1];
  let fill = original
    .replace(
      /<a:blip\b[^>]*\/>/,
      `<a:blip ${external ? "r:link" : "r:embed"}="rIdImagePaint">${effects}</a:blip>`,
    )
    .replace(/<a:srcRect\b[^>]*\/>/, "")
    .replace("<a:stretch", crop + "<a:stretch");
  if (svg) {
    fill = fill.replace(
      "</a:blip>",
      '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdVectorPaint"/></a:ext></a:extLst></a:blip>',
    );
    files["ppt/media/imagePaint.svg"] = strToU8(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#40C080"/></svg>',
    );
    files["[Content_Types].xml"] = strToU8(
      strFromU8(files["[Content_Types].xml"]).replace(
        "</Types>",
        '<Default Extension="svg" ContentType="image/svg+xml"/></Types>',
      ),
    );
  }
  files[slide] = strToU8(
    sourceXml.replace(original, level === "local" ? fill : override),
  );
  if (level !== "local") {
    files[host] = strToU8(
      strFromU8(files[host]).replace(
        /(<p:sp>[^]*?<p:nvPr><p:ph[^>]*\bidx="(?:42|17)"[^]*?<p:spPr>)([^]*?)(<\/p:spPr>)/,
        (_, a, b, c) => a + b + fill + c,
      ),
    );
  }
  const relationship = `<Relationship Id="rIdImagePaint" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${external ? "https://example.com/paint.png" : broken ? "../media/missing.png" : target}"${external ? ' TargetMode="External"' : ""}/>`;
  const hostRels = files[rels(host)]
    ? strFromU8(files[rels(host)])
    : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const vectorRelationship = svg
    ? `<Relationship Id="rIdVectorPaint" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${svg === "broken" ? "../media/missing.svg" : svg === "invalid" ? target : "../media/imagePaint.svg"}"/>`
    : "";
  files[rels(host)] = strToU8(
    hostRels.replace(
      "</Relationships>",
      relationship + vectorRelationship + "</Relationships>",
    ),
  );
  if (level !== "local") {
    // Same rId in the slide has the wrong target and relationship type. It must
    // never satisfy a layout/master-owned image reference.
    files[rels(slide)] = strToU8(
      sourceRels.replace(
        "</Relationships>",
        '<Relationship Id="rIdImagePaint" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/wrong" TargetMode="External"/></Relationships>',
      ),
    );
  }
  return zipSync(files);
}
