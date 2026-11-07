import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";

export async function textStyleFixture({
  family = "Source Serif",
  color = "4E7289",
  hostile = false,
  group = false,
  rich = true,
} = {}) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  P.addSlideTextBox(slide, {
    x: 120000,
    y: 340000,
    w: 5400000,
    h: 3900000,
    text: "Seed",
  });
  const files = unzipSync(await P.savePresentation(pres)),
    sn = P.getSlidePartName(slide).slice(1),
    ln = P.getSlideLayoutPartName(P.getSlideLayout(slide)).slice(1),
    mn = P.getSlideMasterPartName(slide).slice(1);
  const runDefaults = (level) =>
    `<a:defRPr sz="${(22 + level) * 100}"${hostile ? ' b="1" i="1" u="dbl"' : ""}><a:solidFill><a:schemeClr val="accent2"><a:alpha val="65000"/><a:tint val="15000"/></a:schemeClr></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/><a:hlinkClick r:id="styleRel"/><a:extLst><a:ext uri="urn:copy:layout"><probe:payload type="descriptor:face"/></a:ext></a:extLst></a:defRPr>`;
  const list = `<a:lstStyle>${Array.from({ length: 9 }, (_, level) => `<a:lvl${level + 1}pPr algn="${hostile ? "r" : "ctr"}" marL="${(level + 1) * 43000}"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="${level * 100}"/></a:spcBef><a:buBlip><a:blip r:embed="bulletRel"/></a:buBlip><a:tabLst><a:tab pos="234567" algn="ctr"/></a:tabLst>${runDefaults(level)}</a:lvl${level + 1}pPr>`).join("")}</a:lstStyle>`;
  const slot = (body, list, content) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="60" name="Outline probe"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="8"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="120000" y="340000"/><a:ext cx="5400000" cy="3900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody>${body}${list}${content}</p:txBody></p:sp>`;
  const content = Array.from(
    { length: 9 },
    (_, level) =>
      `<a:p><a:pPr lvl="${level}">${level === 1 ? "<a:buNone/>" : ""}</a:pPr><a:r><a:rPr lang="en-US"${level === 0 ? ' b="0" i="0"' : ""}/><a:t>Outline ${level + 1}</a:t></a:r>${level === 0 ? '<a:fld id="{B3E7451F-4EDC-4D1C-9362-F92615ABCD00}" type="slidenum"><a:rPr u="sng"/><a:t>17</a:t></a:fld><a:br><a:rPr sz="1300"/></a:br>' : ""}<a:endParaRPr sz="1100"/></a:p>`,
  ).join("");
  let shape = slot(
    '<a:bodyPr vert="horz"><a:noAutofit/></a:bodyPr>',
    "<a:lstStyle/>",
    content,
  );
  if (group)
    shape = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="59" name="Nested"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7000000" cy="5000000"/><a:chOff x="0" y="0"/><a:chExt cx="7000000" cy="5000000"/></a:xfrm></p:grpSpPr>${shape}</p:grpSp>`;
  files[sn] = strToU8(
    strFromU8(files[sn]).replace(/<p:sp\b[\s\S]*?<\/p:sp>/, shape),
  );
  files[ln] = strToU8(
    strFromU8(files[ln])
      .replace(
        "<p:sldLayout ",
        '<p:sldLayout xmlns:probe="urn:copy:payload" xmlns:descriptor="urn:copy:font" ',
      )
      .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
      .replace(
        "</p:spTree>",
        slot(
          '<a:bodyPr anchor="ctr" lIns="34567" rIns="76543"/>',
          list,
          `<a:p><a:endParaRPr><a:latin typeface="${family}" panose="02020503050505020204" pitchFamily="18" charset="0"/></a:endParaRPr></a:p>`,
        ) + "</p:spTree>",
      ),
  );
  files[mn] = strToU8(
    strFromU8(files[mn])
      .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
      .replace(
        "</p:spTree>",
        slot(
          '<a:bodyPr anchor="b" tIns="12345" bIns="45678"/>',
          '<a:lstStyle><a:lvl1pPr><a:defRPr kern="850" baseline="0"><a:hlinkMouseOver r:id="styleRel"/><a:extLst><a:ext uri="urn:copy:master"><a14:custom xmlns:a14="urn:copy:master-data"/></a:ext></a:extLst></a:defRPr></a:lvl1pPr></a:lstStyle>',
          "<a:p/>",
        ) + "</p:spTree>",
      ),
  );
  const themeName = Object.keys(files).find((n) =>
    /^ppt\/theme\/theme\d+\.xml$/.test(n),
  );
  files[themeName] = strToU8(
    strFromU8(files[themeName])
      .replace(/(<a:majorFont>\s*<a:latin typeface=")[^"]*/, `$1${family}`)
      .replace(
        /(<a:majorFont>[\s\S]*?<a:ea typeface=")[^"]*/,
        `$1${family} East Asian`,
      )
      .replace(
        /(<a:majorFont>[\s\S]*?<a:cs typeface=")[^"]*/,
        `$1${family} Complex`,
      )
      .replace(/(<a:accent2>\s*<a:srgbClr val=")[^"]*/, `$1${color}`),
  );
  const rels = (part) => part.replace(/([^/]+)$/, "_rels/$1.rels");
  const addRel = (part, xml) => {
    const name = rels(part);
    files[name] = strToU8(
      strFromU8(files[name]).replace(
        "</Relationships>",
        xml + "</Relationships>",
      ),
    );
  };
  const external = (id, target) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>`;
  addRel(sn, external("styleRel", "https://example.org/slide"));
  addRel(
    ln,
    external("styleRel", "https://example.org/layout") +
      '<Relationship Id="bulletRel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bullet.png"/>',
  );
  addRel(mn, external("styleRel", "https://example.org/master"));
  files["ppt/media/bullet.png"] = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    ),
    (c) => c.charCodeAt(0),
  );
  if (!strFromU8(files["[Content_Types].xml"]).includes('Extension="png"'))
    files["[Content_Types].xml"] = strToU8(
      strFromU8(files["[Content_Types].xml"]).replace(
        "</Types>",
        '<Default Extension="png" ContentType="image/png"/></Types>',
      ),
    );
  // Placement controls omit interactive links, image bullets and fields,
  // which independently change paint and slide-number display semantics.
  if (!rich)
    for (const [name, data] of Object.entries(files))
      if (name.endsWith(".xml"))
        files[name] = strToU8(
          strFromU8(data)
            .replace(/<a:buBlip>[\s\S]*?<\/a:buBlip>/g, "<a:buNone/>")
            .replace(/<a:hlink(?:Click|MouseOver)\b[^>]*\/>/g, "")
            .replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, ""),
        );
  const result = await parseDeck(zipSync(files)),
    savedSlide = P.getSlides(result)[0],
    shapes = P.getSlideShapes(savedSlide);
  return {
    pres: result,
    slide: savedSlide,
    shape: shapes.find((s) => P.getShapeKind(s) === "shape"),
    group: shapes.find((s) => P.getShapeKind(s) === "group"),
    files,
  };
}
