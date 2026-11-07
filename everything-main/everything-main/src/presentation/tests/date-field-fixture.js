import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { createNumberedDeck } from "./slide-number-fixture.js";

export async function createDateDeck({
  type = "datetime1",
  language = "en-US",
  inherited = false,
  ...options
} = {}) {
  const files = unzipSync(await createNumberedDeck(options));
  for (const name of Object.keys(files)) {
    if (!/\.xml$/.test(name)) continue;
    let xml = strFromU8(files[name]);
    if (!xml.includes('type="slidenum"')) continue;
    xml = xml
      .replaceAll('type="slidenum"', `type="${type}"`)
      .replaceAll("Number: ", "Date: ")
      .replaceAll("<a:t>999</a:t>", "<a:t>CACHED-DATE</a:t>");
    xml = xml.replaceAll(
      '<a:rPr b="1"/>',
      `<a:rPr b="1"${inherited ? "" : ` lang="${language}"`}/>`,
    );
    if (inherited)
      xml = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (paragraph) => {
        if (!paragraph.includes("CACHED-DATE")) return paragraph;
        const rpr = `<a:defRPr lang="${language}"/>`;
        return paragraph.includes("</a:pPr>")
          ? paragraph.replace("</a:pPr>", rpr + "</a:pPr>")
          : paragraph.replace("<a:p>", `<a:p><a:pPr>${rpr}</a:pPr>`);
      });
    files[name] = strToU8(xml);
  }
  return zipSync(files);
}
