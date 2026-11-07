import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  parseXml,
  firstChildElement,
  getAttrValue,
  qname,
  NS,
} from "../lib/pptx/src/internal/xml/index.ts";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";

test("preset colors retain their transforms through clipboard and .pptx download", async ({
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
  P.setShapeFill(shape, "#FF0000");
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1);
  const preset = '<a:prstClr val="red"><a:shade val="50000"/></a:prstClr>';
  files[name] = strToU8(
    strFromU8(files[name]).replace('<a:srgbClr val="FF0000"/>', preset),
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Preset color.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(zipSync(files)),
  });
  const object = page.locator(".object-hit"),
    image = page.locator(".slide-image");
  await expect(object).toHaveCount(1);
  const fills = async () =>
    [
      ...decodeURIComponent(await image.getAttribute("src")).matchAll(
        /fill="#BC0000"/g,
      ),
    ].length;
  expect(await fills()).toBe(1);
  await object.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(object).toHaveCount(2);
  expect(await fills()).toBe(2);
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
  for (const sh of P.getSlideShapes(slide))
    expect(P.getShapeFillColorResolved(loaded, sh)).toBe("#BC0000");
  for (const sh of P.getSlideShapes(slide)) {
    const root = parseXml(P.getShapeXmlString(sh)).root,
      props = firstChildElement(root, qname("p", "spPr", NS.pml)),
      fill = firstChildElement(props, qname("a", "solidFill", NS.dml)),
      color = firstChildElement(fill, qname("a", "prstClr", NS.dml)),
      shade = firstChildElement(color, qname("a", "shade", NS.dml));
    expect(getAttrValue(color, qname("", "val", ""))).toBe("red");
    expect(getAttrValue(shade, qname("", "val", ""))).toBe("50000");
  }
});
