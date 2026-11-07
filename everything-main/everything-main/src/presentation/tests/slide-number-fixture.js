import { P, createDeck } from "../src/model.js";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

export async function createNumberedDeck({
  start = 40,
  count = 2,
  owner = "slide",
  table = false,
} = {}) {
  const pres = createDeck();
  for (let i = 0; i < count; i++) {
    const slide = i === 0 ? P.getSlides(pres)[0] : P.addBlankSlide(pres);
    P.addSlideTextBox(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(5),
      h: P.inches(1),
      text: `Page ${String.fromCharCode(65 + i)}`,
    });
    if (table)
      P.addSlideTable(slide, {
        x: P.inches(1),
        y: P.inches(3),
        w: P.inches(5),
        h: P.inches(1),
        rows: [["NUMBER"]],
      });
    else
      P.addSlideTextBox(slide, {
        x: P.inches(1),
        y: P.inches(3),
        w: P.inches(5),
        h: P.inches(1),
        text: "NUMBER",
      });
  }
  const files = unzipSync(await P.savePresentation(pres));
  if (start !== null)
    files["ppt/presentation.xml"] = strToU8(
      strFromU8(files["ppt/presentation.xml"]).replace(
        "<p:presentation ",
        `<p:presentation firstSlideNum="${start}" `,
      ),
    );
  for (const slide of P.getSlides(pres)) {
    const name = P.getSlidePartName(slide).slice(1);
    let xml = strFromU8(files[name]);
    xml = xml.replace(
      /<a:r>(?:(?!<\/a:r>)[\s\S])*<a:t>NUMBER<\/a:t><\/a:r>/,
      '<a:r><a:t>Number: </a:t></a:r><a:fld id="{84633254-AB21-42A1-B852-989A63543703}" type="slidenum"><a:rPr b="1"/><a:t>999</a:t></a:fld><a:r><a:t> / literal 999</a:t></a:r>',
    );
    if (owner !== "slide") {
      const shape = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g).at(-1);
      const target = (
        owner === "layout"
          ? P.getSlideLayoutPartName(P.getSlideLayout(slide))
          : P.getSlideMasterPartName(slide)
      ).slice(1);
      if (!strFromU8(files[target]).includes("84633254-AB21"))
        files[target] = strToU8(
          strFromU8(files[target]).replace(
            "</p:spTree>",
            shape.replace(/<p:cNvPr id="\d+"/, '<p:cNvPr id="125"') +
              "</p:spTree>",
          ),
        );
      xml = xml.replace(shape, "");
    }
    files[name] = strToU8(xml);
  }
  return zipSync(files);
}
