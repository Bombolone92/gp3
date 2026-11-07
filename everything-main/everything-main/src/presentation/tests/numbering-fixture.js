import { P, createDeck, parseDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const numberingRows = [
  { level: 0, type: "arabicPeriod", start: 2 },
  { level: 1, type: "alphaLcParenR" },
  { level: 1, type: "alphaLcParenR" },
  { level: 0, type: "arabicPeriod", start: 2 },
  { level: 1, type: "none" },
  { level: 0, type: "arabicPeriod", start: 2 },
];
export const numberingMarkers = ["2.", "a)", "b)", "3.", "4."];
const bullet = (row) =>
  row.type === undefined
    ? ""
    : row.type === "none"
      ? "<a:buNone/>"
      : row.type === "char"
        ? '<a:buChar char="◆"/>'
        : `<a:buAutoNum type="${row.type}"${row.start === undefined ? "" : ` startAt="${row.start}"`}/>`;

// Owned controls exercise list structure and native metadata, without corpus
// XML or external fonts. Paragraph bodies deliberately differ from markers.
export async function numberingDeck(
  rows = numberingRows,
  { table = false, inherit = "own", styles = [], cells = 1 } = {},
) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  if (table)
    P.addSlideTable(s, {
      x: P.inches(0.5),
      y: P.inches(0.5),
      w: P.inches(11),
      h: P.inches(6),
      rows: [Array(cells).fill("Seed")],
    });
  else
    P.addSlideTextBox(s, {
      x: P.inches(0.5),
      y: P.inches(0.5),
      w: P.inches(11),
      h: P.inches(6),
      text: "Seed",
    });
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1);
  const list = `<a:lstStyle>${styles.map((row, i) => `<a:lvl${i + 1}pPr marL="${(i + 1) * 342900}" indent="-171450">${bullet(row)}</a:lvl${i + 1}pPr>`).join("")}</a:lstStyle>`;
  const content = rows
    .map(
      (row, i) =>
        `<a:p><a:pPr lvl="${row.level ?? 0}" marL="${((row.level ?? 0) + 1) * 342900}" indent="-171450">${bullet(row)}</a:pPr><a:r><a:rPr sz="1400"><a:latin typeface="Arial"/></a:rPr><a:t>${row.empty ? "" : `Number body ${i + 1}`}</a:t></a:r></a:p>`,
    )
    .join("");
  const tag = table ? "a:txBody" : "p:txBody";
  const body = `<${tag}><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="t" compatLnSpc="0"><a:noAutofit/></a:bodyPr>${inherit === "own" ? list : "<a:lstStyle/>"}${content}</${tag}>`;
  let xml = strFromU8(files[name]).replace(
    new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`),
    () => body,
  );
  if (table)
    xml = xml.replace(
      new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "g"),
      () => body,
    );
  if (inherit !== "own") {
    const original = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
    const slot = original.replace(
      /<p:nvPr\s*\/>/,
      '<p:nvPr><p:ph type="body" idx="42"/></p:nvPr>',
    );
    xml = xml.replace(original, () => slot);
    const template = slot.replace(
      /<p:txBody\b[\s\S]*?<\/p:txBody>/,
      `<p:txBody><a:bodyPr/>${list}<a:p/></p:txBody>`,
    );
    const layout = P.getSlideLayoutPartName(P.getSlideLayout(s)).slice(1),
      master = P.getSlideMasterPartName(s).slice(1);
    for (const part of [layout, master])
      files[part] = strToU8(
        strFromU8(files[part])
          .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
          .replace(
            "</p:spTree>",
            ((inherit === "layout" && part === layout) ||
            (inherit === "master" && part === master)
              ? template
              : slot.replace(
                  /<p:txBody\b[\s\S]*?<\/p:txBody>/,
                  "<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>",
                )) + "</p:spTree>",
          ),
      );
  }
  files[name] = strToU8(xml);
  return parseDeck(zipSync(files));
}
