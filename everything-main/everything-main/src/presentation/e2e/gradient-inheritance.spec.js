import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";

test("partial gradients retain inheritance through clipboard and .pptx download", async ({
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
  P.setShapeGradientFill(shape, {
    angleDeg: 0,
    stops: [
      { offset: 0, color: "#FF0000" },
      { offset: 0.5, color: "#00FF00" },
      { offset: 1, color: "#0000FF" },
    ],
  });
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1);
  files[name] = strToU8(
    strFromU8(files[name])
      .replace(/<a:lin\b[^>]*\/>/, "")
      .replace(
        "</p:spPr>",
        '</p:spPr><p:style><a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="2"><a:srgbClr val="FFFFFF"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></p:style>',
      ),
  );
  const theme = Object.keys(files).find((n) => /\/theme\d+\.xml$/.test(n));
  files[theme] = strToU8(
    strFromU8(files[theme]).replace(
      /<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/,
      '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill><a:lin ang="5400000" scaled="1"/></a:gradFill></a:fillStyleLst>',
    ),
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Partial gradient.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(zipSync(files)),
  });
  const object = page.locator(".object-hit");
  await expect(object).toHaveCount(1);
  const directions = async () =>
    page.locator(".slide-image").evaluate((im) => {
      const xml = new DOMParser().parseFromString(
        decodeURIComponent(im.src.split(",")[1]),
        "image/svg+xml",
      );
      return [...xml.querySelectorAll("linearGradient")].map((g) => ({
        x1: Number(g.getAttribute("x1")),
        x2: Number(g.getAttribute("x2")),
        y1: Number(g.getAttribute("y1")),
        y2: Number(g.getAttribute("y2")),
      }));
    });
  expect(await directions()).toEqual([{ x1: 0.5, x2: 0.5, y1: 0, y2: 1 }]);
  await object.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(object).toHaveCount(2);
  expect(await directions()).toEqual(
    Array(2).fill({ x1: 0.5, x2: 0.5, y1: 0, y2: 1 }),
  );
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
  // The authored source keeps its partial gradient. The clipboard writes the
  // effective source shading explicitly so a new template cannot change it.
  expect(P.getShapeGradientFill(shapes[0]).angleDeg).toBe(0);
  expect(P.getShapeGradientFill(shapes[1]).angleDeg).toBe(90);
  for (const sh of shapes) {
    expect(P.getShapeGradientFillEffective(loaded, sh).angleDeg).toBe(90);
  }
  const xml = strFromU8(unzipSync(bytes)[P.getSlidePartName(slide).slice(1)]);
  expect(xml.match(/<a:gradFill\b[\s\S]*?<\/a:gradFill>/g)).toHaveLength(2);
  expect(P.getShapeXmlString(shapes[0])).not.toContain("<a:lin");
  expect(P.getShapeXmlString(shapes[1])).toContain("<a:lin");
});
