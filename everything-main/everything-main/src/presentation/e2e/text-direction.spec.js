import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck } from "../src/model.js";
import { fixture } from "../tests/text-direction-fixture.js";

const svg = (page) =>
  page.locator(".slide-image").evaluate(async (img) => {
    await img.decode();
    return (await fetch(img.src)).text();
  });
test("horizontal overrides survive imported vertical layouts, clipboard and .pptx download", async ({
  page,
}) => {
  const f = await fixture({ slideDirection: "horz" });
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Direction overrides.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(f.pres)),
  });
  await expect(page.locator(".object-hit")).toHaveCount(1);
  const before = await svg(page);
  expect(before).toContain("Direction override");
  expect(before).not.toMatch(/rotate\(-?90/);
  await page.locator(".object-hit").first().click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".object-hit")).toHaveCount(2);
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const loaded = await parseDeck(await readFile(await (await download).path()));
  for (const shape of P.getSlideShapes(P.getSlides(loaded)[0])) {
    expect(P.getShapeXmlString(shape)).toContain('vert="horz"');
    expect(P.getShapeBodyPrEffective(loaded, shape).vert).toBeNull();
  }
  expect(P.getShapeText(P.getSlideShapes(P.getSlides(loaded)[0])[1])).toBe(
    "Direction override\nAnother line",
  );
});
