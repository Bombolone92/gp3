import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck, preview } from "../src/model.js";
import { backgroundThemeTransferFixture } from "../tests/background-theme-fixture.js";

test("backgrounds retain each owning master theme through canvas, slideshow and PPTX download", async ({
  page,
}) => {
  const { pres, expected } = await backgroundThemeTransferFixture();
  const original = expected.map((uri) =>
    decodeURIComponent(uri.slice(uri.indexOf(",") + 1)),
  );
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
    name: "Owning background themes.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(pres)),
  });
  const thumbs = page.locator(".slide-thumb");
  await expect(thumbs).toHaveCount(expected.length);
  for (let i = 0; i < expected.length; i++) {
    await thumbs.nth(i).click();
    const svg = await page.locator(".slide-image").evaluate(async (img) => {
      await img.decode();
      return (await fetch(img.src)).text();
    });
    expect(svg).toBe(original[i]);
  }
  await thumbs.nth(0).click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  for (let i = 1; i < expected.length; i++) {
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".presenter-controls")).toContainText(
      `${i + 1} / ${expected.length}`,
    );
  }
  await page.keyboard.press("Escape");
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const loaded = await parseDeck(
    await readFile(await (await downloading).path()),
  );
  expect(P.getSlides(loaded).map((slide) => preview(loaded, slide))).toEqual(
    expected,
  );
});
