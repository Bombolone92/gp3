import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck, MIME } from "../src/model.js";
import { paintStyleFixture } from "../tests/paint-style-copy-fixture.js";

const fileMenu = (page) =>
  page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true });
const load = async (page, f, name) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: MIME,
    buffer: Buffer.from(await P.savePresentation(f.pres)),
  });
  await expect(page.locator(".object-hit")).toHaveCount(1);
};
const download = async (page) => {
  await fileMenu(page).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  return parseDeck(await readFile(await (await event).path()));
};

test("picture clipboard keeps inherited native paint in both directions through download", async ({
  page,
}) => {
  const source = await paintStyleFixture(),
    destination = await paintStyleFixture({
      bounds: {
        x: P.inches(6),
        y: P.inches(1),
        w: P.inches(3),
        h: P.inches(2),
      },
      layout:
        '<a:solidFill><a:srgbClr val="EFBD49"/></a:solidFill><a:ln w="180000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:prstDash val="dash"/></a:ln><a:effectLst><a:glow rad="160000"><a:schemeClr val="accent1"/></a:glow></a:effectLst>',
    });
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  await load(page, source, "Source paint.pptx");
  const objects = page.locator(".object-hit");
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await load(page, destination, "Destination paint.pptx");
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  let saved = await download(page),
    shapes = P.getSlideShapes(P.getSlides(saved)[0]);
  expect(P.getShapeStrokeEffective(saved, shapes[0])).toMatchObject({
    kind: "solid",
    color: "scheme:accent1",
    widthEmu: 180000,
  });
  expect(P.getShapeFillEffective(saved, shapes[1])).toEqual({ kind: "none" });
  expect(P.getShapeStrokeEffective(saved, shapes[1])).toEqual({ kind: "none" });
  expect(P.getShapeEffectsEffective(saved, shapes[1])).toEqual([]);
  const svg = await page.locator(".slide-image").evaluate(async (img) => {
    await img.decode();
    return (await fetch(img.src)).text();
  });
  expect(svg).toContain("<clipPath");
  expect(svg.match(/stroke="#315E87"/g)).toHaveLength(1);
  await objects.first().click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await load(page, source, "Return paint.pptx");
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(objects).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(objects).toHaveCount(2);
  saved = await download(page);
  shapes = P.getSlideShapes(P.getSlides(saved)[0]);
  expect(P.getShapeStrokeEffective(saved, shapes[1])).toMatchObject({
    kind: "solid",
    color: "#315E87",
    widthEmu: 180000,
  });
  expect(P.getShapeStrokeDash(shapes[1])).toBe("dash");
  const returnedSvg = await page
    .locator(".slide-image")
    .evaluate(async (img) => {
      await img.decode();
      return (await fetch(img.src)).text();
    });
  expect(returnedSvg).toContain("stroke-dasharray=");
  expect(P.getShapeEffectsEffective(saved, shapes[1])).toMatchObject([
    { kind: "glow", color: "#315E87", radiusEmu: 160000 },
  ]);
  expect(P.getShapeGeometryEffective(saved, shapes[1])).toEqual(
    P.getShapeGeometryEffective(destination.pres, destination.shape),
  );
});
