import { rasterRegion } from "./render.js";
import { createZip, xml } from "./zip.js";
import { textOf } from "./export-layout.js";
import { addTranslations, t } from "./i18n.js";

addTranslations({
  "Board image": "Image du tableau",
  "Too many slides. Export fewer frames at a time.":
    "Trop de diapositives. Exportez moins de cadres à la fois.",
});

// 16:9 widescreen slides, in EMU (914,400 per inch).
const SLIDE_W = 12192000,
  SLIDE_H = 6858000,
  MARGIN = 457200,
  TITLE_Y = 228600,
  TITLE_H = 685800,
  PICTURE_Y = 1005840,
  PICTURE_BOTTOM = 274320;
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TYPE = "application/vnd.openxmlformats-officedocument";
const rels = (list) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${type.includes("/") ? type : `${REL}/${type}`}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;
const group =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (x, y, w, h) =>
  `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`;
const level = (size, font, extra = "") =>
  `<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${extra}<a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+${font}-lt"/><a:ea typeface="+${font}-ea"/><a:cs typeface="+${font}-cs"/></a:defRPr></a:lvl1pPr>`;
const clrMap =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const titleShape = (text, lang) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(MARGIN, TITLE_Y, SLIDE_W - MARGIN * 2, TITLE_H)}</p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p>${text ? `<a:r><a:rPr lang="${lang}" dirty="0"/><a:t>${xml(text)}</a:t></a:r>` : `<a:endParaRPr lang="${lang}" dirty="0"/>`}</a:p></p:txBody></p:sp>`;

function theme(name) {
  const colors = [
    ["dk2", "44546A"],
    ["lt2", "E7E6E6"],
    ["accent1", "4472C4"],
    ["accent2", "ED7D31"],
    ["accent3", "A5A5A5"],
    ["accent4", "FFC000"],
    ["accent5", "5B9BD5"],
    ["accent6", "70AD47"],
    ["hlink", "0563C1"],
    ["folHlink", "954F72"],
  ];
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w) =>
    `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return (
    `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}"><a:themeElements>` +
    `<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${colors.map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join("")}</a:clrScheme>` +
    `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Office"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

// Speaker notes list the region's text in reading order, with the
// description of each image or drawing that has one.
export function regionNotes(region) {
  return region.items
    .filter((i) => !["image", "pen"].includes(i.type) || i.alt)
    .filter((i) => i.type !== "frame" || i.text !== region.name)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .flatMap((i) =>
      (["image", "pen"].includes(i.type) ? i.alt : textOf(i))
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replaceAll("\t", " | ").trim()),
    )
    .filter(Boolean);
}

function base64Bytes(dataURL) {
  const binary = atob(dataURL.slice(dataURL.indexOf(",") + 1)),
    bytes = new Uint8Array(binary.length);
  for (let n = 0; n < binary.length; n++) bytes[n] = binary.charCodeAt(n);
  return bytes;
}

// One slide per region: a high-resolution render fitted to a 16:9 slide, the
// region name as the slide title, and its text as speaker notes.
export async function exportPPTX(
  b,
  regions,
  { lang = "en", rasterizer = rasterRegion } = {},
) {
  if (regions.length > 200)
    throw Error("Too many slides. Export fewer frames at a time.");
  const language = lang === "fr" ? "fr-CA" : "en-CA";
  const slides = [];
  for (const region of regions) {
    const canvas = await rasterizer(
      { ...b, items: region.items },
      region.rect,
      { scale: 3, maxSize: 3840, mindCounts: region.mindCounts },
    );
    slides.push({
      region,
      png: base64Bytes(canvas.toDataURL("image/png")),
      notes: regionNotes(region),
    });
  }
  const areaW = SLIDE_W - MARGIN * 2,
    areaH = SLIDE_H - PICTURE_Y - PICTURE_BOTTOM;
  const entries = [];
  const count = slides.length;
  entries.push({
    name: "[Content_Types].xml",
    data:
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="${TYPE}.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${TYPE}.presentationml.slideMaster+xml"/>` +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${TYPE}.presentationml.slideLayout+xml"/>` +
      `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${TYPE}.presentationml.notesMaster+xml"/>` +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="${TYPE}.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="${TYPE}.theme+xml"/>` +
      slides
        .map(
          (_, n) =>
            `<Override PartName="/ppt/slides/slide${n + 1}.xml" ContentType="${TYPE}.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${n + 1}.xml" ContentType="${TYPE}.presentationml.notesSlide+xml"/>`,
        )
        .join("") +
      `<Override PartName="/ppt/presProps.xml" ContentType="${TYPE}.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="${TYPE}.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="${TYPE}.presentationml.tableStyles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="${TYPE}.extended-properties+xml"/></Types>`,
  });
  entries.push({
    name: "_rels/.rels",
    data: rels([
      ["rId1", "officeDocument", "ppt/presentation.xml"],
      [
        "rId2",
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "docProps/core.xml",
      ],
      ["rId3", "extended-properties", "docProps/app.xml"],
    ]),
  });
  entries.push({
    name: "docProps/core.xml",
    data: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(b.title || "")}</dc:title><dc:creator>Whiteboard</dc:creator><dc:language>${language}</dc:language></cp:coreProperties>`,
  });
  entries.push({
    name: "docProps/app.xml",
    data: `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Whiteboard</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${count}</Slides><Notes>${count}</Notes></Properties>`,
  });
  entries.push({
    name: "ppt/presentation.xml",
    data:
      `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>` +
      slides
        .map((_, n) => `<p:sldId id="${256 + n}" r:id="rId${n + 3}"/>`)
        .join("") +
      `</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="${language}"/></a:defPPr>${level(1800, "mn")}</p:defaultTextStyle></p:presentation>`,
  });
  entries.push({
    name: "ppt/_rels/presentation.xml.rels",
    data: rels([
      ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
      ["rId2", "notesMaster", "notesMasters/notesMaster1.xml"],
      ...slides.map((_, n) => [
        `rId${n + 3}`,
        "slide",
        `slides/slide${n + 1}.xml`,
      ]),
      [`rId${count + 3}`, "presProps", "presProps.xml"],
      [`rId${count + 4}`, "viewProps", "viewProps.xml"],
      [`rId${count + 5}`, "theme", "theme/theme1.xml"],
      [`rId${count + 6}`, "tableStyles", "tableStyles.xml"],
    ]),
  });
  entries.push({
    name: "ppt/presProps.xml",
    data: `${HEAD}<p:presentationPr ${NS}/>`,
  });
  entries.push({
    name: "ppt/viewProps.xml",
    data: `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
  });
  entries.push({
    name: "ppt/tableStyles.xml",
    data: `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
  });
  entries.push({ name: "ppt/theme/theme1.xml", data: theme("Whiteboard") });
  entries.push({
    name: "ppt/theme/theme2.xml",
    data: theme("Whiteboard Notes"),
  });
  entries.push({
    name: "ppt/slideMasters/slideMaster1.xml",
    data:
      `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${group}` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(MARGIN, TITLE_Y, SLIDE_W - MARGIN * 2, TITLE_H)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
      `<p:txStyles><p:titleStyle>${level(2800, "mj", '<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>')}</p:titleStyle><p:bodyStyle>${level(1800, "mn", '<a:spcBef><a:spcPts val="600"/></a:spcBef><a:buNone/>')}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${level(1800, "mn")}</p:otherStyle></p:txStyles></p:sldMaster>`,
  });
  entries.push({
    name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    data: rels([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId2", "theme", "../theme/theme1.xml"],
    ]),
  });
  entries.push({
    name: "ppt/slideLayouts/slideLayout1.xml",
    data: `${HEAD}<p:sldLayout ${NS} type="titleOnly" preserve="1"><p:cSld name="Title Only"><p:spTree>${group}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  });
  entries.push({
    name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    data: rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
  });
  entries.push({
    name: "ppt/notesMasters/notesMaster1.xml",
    data:
      `${HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${group}` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(685800, 1143000, 5486400, 3086100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(685800, 4400550, 5486400, 3600450)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Notes</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld>${clrMap}<p:notesStyle>${level(1200, "mn")}</p:notesStyle></p:notesMaster>`,
  });
  entries.push({
    name: "ppt/notesMasters/_rels/notesMaster1.xml.rels",
    data: rels([["rId1", "theme", "../theme/theme2.xml"]]),
  });
  slides.forEach(({ region, png, notes }, n) => {
    const rect = region.rect,
      scale = Math.min(areaW / rect.w, areaH / rect.h),
      w = rect.w * scale,
      h = rect.h * scale;
    const title = region.name || t("Frame");
    const descr = `${title}. ${notes.join(" ")}`.slice(0, 1000);
    entries.push({
      name: `ppt/slides/slide${n + 1}.xml`,
      data:
        `${HEAD}<p:sld ${NS}><p:cSld><p:spTree>${group}${titleShape(title, language)}` +
        `<p:pic><p:nvPicPr><p:cNvPr id="3" name="${xml(t("Board image"))}" descr="${xml(descr)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(MARGIN + (areaW - w) / 2, PICTURE_Y + (areaH - h) / 2, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
        `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    });
    entries.push({
      name: `ppt/slides/_rels/slide${n + 1}.xml.rels`,
      data: rels([
        ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
        ["rId2", "image", `../media/image${n + 1}.png`],
        ["rId3", "notesSlide", `../notesSlides/notesSlide${n + 1}.xml`],
      ]),
    });
    const paragraphs = notes.length
      ? notes
          .slice(0, 500)
          .map(
            (line) =>
              `<a:p><a:r><a:rPr lang="${language}" dirty="0"/><a:t>${xml(line.slice(0, 2000))}</a:t></a:r></a:p>`,
          )
          .join("")
      : `<a:p><a:endParaRPr lang="${language}" dirty="0"/></a:p>`;
    entries.push({
      name: `ppt/notesSlides/notesSlide${n + 1}.xml`,
      data:
        `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${group}` +
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>` +
        `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
    });
    entries.push({
      name: `ppt/notesSlides/_rels/notesSlide${n + 1}.xml.rels`,
      data: rels([
        ["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"],
        ["rId2", "slide", `../slides/slide${n + 1}.xml`],
      ]),
    });
    entries.push({ name: `ppt/media/image${n + 1}.png`, data: png });
  });
  return new Blob([createZip(entries)], {
    type: `${TYPE}.presentationml.presentation`,
  });
}
