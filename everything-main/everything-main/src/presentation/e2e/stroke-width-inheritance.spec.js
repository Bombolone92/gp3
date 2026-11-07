import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";

test("outline widths inherit from theme styles through clipboard and .pptx download", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const p = createDeck("blank"),
    s = P.getSlides(p)[0],
    shape = P.addSlideShape(s, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(4),
      h: P.inches(2),
      preset: "rect",
    });
  P.setShapeNoFill(shape);
  P.setShapeStroke(shape, { color: "#1267B2" });
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1);
  files[name] = strToU8(
    strFromU8(files[name]).replace(
      "</p:spPr>",
      '</p:spPr><p:style><a:lnRef idx="2"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="0"><a:srgbClr val="FFFFFF"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></p:style>',
    ),
  );
  const theme = Object.keys(files).find((n) => /\/theme\d+\.xml$/.test(n));
  files[theme] = strToU8(
    strFromU8(files[theme]).replace(
      /<a:lnStyleLst>[\s\S]*?<\/a:lnStyleLst>/,
      '<a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="76200"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="101600"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>',
    ),
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Inherited outline.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(zipSync(files)),
  });
  const object = page.locator(".object-hit");
  await expect(object).toHaveCount(1);
  const widths = async () =>
    page.locator(".slide-image").evaluate((im) => {
      const xml = new DOMParser().parseFromString(
        decodeURIComponent(im.src.split(",")[1]),
        "image/svg+xml",
      );
      return [...xml.querySelectorAll('[stroke="#1267B2"]')].map((g) =>
        Number(g.getAttribute("stroke-width")),
      );
    });
  expect(await widths()).toEqual([8]);
  await object.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(object).toHaveCount(2);
  expect(await widths()).toEqual([8, 8]);
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const bytes = await readFile(await (await downloaded).path()),
    loaded = await parseDeck(bytes),
    slide = P.getSlides(loaded)[0];
  expect(P.getSlideShapes(slide)).toHaveLength(2);
  const shapes = P.getSlideShapes(slide);
  // Retain authored inheritance on the source and materialize its effective
  // width on the clipboard copy, independently of the destination's theme.
  expect(P.getShapeStroke(shapes[0]).widthEmu).toBeUndefined();
  expect(P.getShapeStroke(shapes[1]).widthEmu).toBe(76200);
  for (const sh of shapes) {
    expect(P.getShapeStrokeEffective(loaded, sh).widthEmu).toBe(76200);
  }
  const xml = strFromU8(unzipSync(bytes)[P.getSlidePartName(slide).slice(1)]);
  expect(xml.match(/<a:lnRef idx="2"/g)).toHaveLength(2);
  expect(P.getShapeXmlString(shapes[0])).not.toMatch(/<a:ln[^>]*\bw=/);
  expect(P.getShapeXmlString(shapes[1])).toMatch(/<a:ln[^>]*\bw="76200"/);
});
