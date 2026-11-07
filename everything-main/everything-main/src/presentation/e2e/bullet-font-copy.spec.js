import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck } from "../src/model.js";
import { bulletFontFixture } from "../tests/bullet-font-fixture.js";

test("number and character bullet fonts survive clipboard transfer and PPTX download", async ({
  page,
}) => {
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
    name: "Bullet fonts.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(await bulletFontFixture())),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(6);
  await objects.nth(0).click();
  await objects.nth(5).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await expect(objects).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  const fonts = await page.locator(".slide-image").evaluate(async (img) => {
    await img.decode();
    const xml = await (await fetch(img.src)).text();
    const doc = new DOMParser().parseFromString(xml, "image/svg+xml");
    return [...doc.querySelectorAll("text")]
      .filter((el) => ["1.", "•"].includes(el.textContent))
      .map((el) => el.getAttribute("font-family"));
  });
  expect(fonts[0]).toContain("Georgia");
  expect(fonts[1]).toContain("Courier New");
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const pres = await parseDeck(await readFile(await (await downloaded).path()));
  const [number, character] = P.getSlideShapes(P.getSlides(pres)[0]);
  expect(P.getShapeRunFormatEffective(pres, number, 0, 0).font).toBe("Georgia");
  expect(P.getParagraphBulletStyleEffective(pres, character, 0).font).toBe(
    "Courier New",
  );
});
