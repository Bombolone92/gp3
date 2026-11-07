import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, MIME, parseDeck, preview } from "../src/model.js";
import { masterShapeVisibilityTransferFixture } from "../tests/master-shape-visibility-fixture.js";

test("master visibility survives canvas, slideshow, duplication and editable PPTX download", async ({
  page,
}) => {
  const { pres, cases } = await masterShapeVisibilityTransferFixture(),
    original = P.getSlides(pres).map((s) => preview(pres, s)),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
    name: "Master artwork visibility.pptx",
    mimeType: MIME,
    buffer: Buffer.from(await P.savePresentation(pres)),
  });
  await expect(page.locator(".slide-thumb")).toHaveCount(cases.length);
  const assertArtwork = async (image, index) => {
    const svg = await image.evaluate(async (img) => {
      await img.decode();
      return (await fetch(img.src)).text();
    });
    expect(svg.includes("Mapped master")).toBe(cases[index].master);
    expect(svg.includes("Mapped layout")).toBe(cases[index].layout);
    expect(svg).toContain("Mapped slide");
    expect(svg).toContain('fill="#000000"');
  };
  for (let i = 0; i < cases.length; i++) {
    const thumb = page.getByRole("button", {
      name: new RegExp(`^Slide ${i + 1}:`),
    });
    if (!(await thumb.isVisible()))
      await page
        .getByRole("button", { name: "Toggle slide navigator", exact: true })
        .click();
    await thumb.click();
    await assertArtwork(page.locator("#slide-canvas .slide-image"), i);
  }
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await assertArtwork(page.locator("img.presenter-slide").first(), 2);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".presenter-controls")).toContainText("2 / 3");
  await assertArtwork(
    page.locator("img.presenter-slide:not(.presenter-leaving)"),
    1,
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".presenter-controls")).toContainText("1 / 3");
  await assertArtwork(
    page.locator("img.presenter-slide:not(.presenter-leaving)"),
    0,
  );
  await page.keyboard.press("Escape");
  const options = page.getByRole("button", {
    name: "Options for slide 3",
    exact: true,
  });
  if (!(await options.isVisible()))
    await page
      .getByRole("button", { name: "Toggle slide navigator", exact: true })
      .click();
  await options.click();
  await page
    .getByRole("menuitem", { name: "Duplicate slide", exact: true })
    .click();
  await expect(page.locator("#slide-position")).toHaveText("Slide 4 of 4");
  await assertArtwork(page.locator("#slide-canvas .slide-image"), 2);
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
  expect(P.getSlides(loaded).map((s) => preview(loaded, s))).toEqual([
    ...original,
    original[2],
  ]);
  expect(P.validatePresentation(loaded)).toEqual([]);
  expect(errors).toEqual([]);
});
