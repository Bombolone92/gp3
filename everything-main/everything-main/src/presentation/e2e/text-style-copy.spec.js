import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck } from "../src/model.js";
import { textStyleFixture } from "../tests/text-style-copy-fixture.js";

test("clipboard retains inherited text styles across presentations and .pptx download", async ({
  page,
}) => {
  const source = await textStyleFixture();
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
    name: "Outline styles.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(source.pres)),
  });
  const objects = page.locator(".object-hit");
  await expect(objects).toHaveCount(1);
  await objects.click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await expect(objects).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(1);
  const svg = await page.locator(".slide-image").evaluate(async (img) => {
    await img.decode();
    return (await fetch(img.src)).text();
  });
  expect(svg).toContain("Outline 1");
  expect(svg).toContain('text-anchor="middle"');
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const loaded = await parseDeck(await readFile(await (await download).path())),
    shape = P.getSlideShapes(P.getSlides(loaded)[0])[0];
  for (let level = 0; level < 9; level++)
    expect(P.getShapeRunFormatEffective(loaded, shape, level, 0)).toMatchObject(
      P.getShapeRunFormatEffective(source.pres, source.shape, level, 0),
    );
  expect(P.getShapeBodyPrEffective(loaded, shape)).toMatchObject({
    anchor: "center",
    margins: { left: 34567, right: 76543, top: 12345, bottom: 45678 },
  });
  expect(P.getShapeXmlString(shape)).toContain('pos="234567"');
  expect(P.getShapeXmlString(shape)).toContain('panose="02020503050505020204"');
});
