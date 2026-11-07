import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck, MIME } from "../src/model.js";
import {
  originalImage,
  replacementImage,
  sharedImageFixture,
} from "../tests/image-replacement-fixture.js";

const fileMenu = (page) =>
  page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true });
const navigate = async (page, n) => {
  const thumbnail = page.getByRole("button", {
    name: new RegExp(`^Slide ${n}:`),
  });
  if (!(await thumbnail.isVisible()))
    await page
      .getByRole("button", { name: "Toggle slide navigator", exact: true })
      .click();
  await thumbnail.click();
};
const closePanel = async (page) => {
  const close = page.getByRole("button", { name: "Close format panel" });
  if (await close.isVisible()) await close.click();
};
const download = async (page) => {
  await fileMenu(page).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  return parseDeck(await readFile(await (await event).path()));
};
for (const scenario of ["duplicated slide", "shared relationship"])
  test(`replacing a picture with a ${scenario} keeps other pictures through undo, redo and download`, async ({
    page,
  }) => {
    await page.route("https://js.puter.com/v2/", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
      }),
    );
    await page.goto("/#/home");
    const f = await sharedImageFixture(),
      chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Import PPTX", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: "Shared pictures.pptx",
      mimeType: MIME,
      buffer: Buffer.from(await P.savePresentation(f.pres)),
    });
    await expect(page.locator(".object-hit")).toHaveCount(2);
    const before = await page.locator(".slide-image").getAttribute("src");
    if (scenario === "duplicated slide") {
      const options = page.getByRole("button", {
        name: "Options for slide 1",
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
      await expect(page.locator("#slide-position")).toHaveText("Slide 2 of 2");
    }
    await page.locator(".object-hit").first().click();
    const panel = page.getByRole("complementary", { name: "Format panel" });
    if (!(await panel.isVisible())) {
      await page
        .getByRole("tab", { name: "Picture Format", exact: true })
        .click();
      const format = page.getByRole("button", {
        name: "Format Pane",
        exact: true,
      });
      if (!(await format.isVisible())) {
        await page.getByRole("button", { name: "Size", exact: true }).click();
        const bounds = await page
          .getByRole("dialog", { name: "Size", exact: true })
          .boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          page.viewportSize().width,
        );
      }
      await format.click();
    }
    const chooseReplacement = page.waitForEvent("filechooser");
    await panel
      .getByRole("button", { name: "Replace image", exact: true })
      .click();
    await (
      await chooseReplacement
    ).setFiles({
      name: "Replacement.png",
      mimeType: "image/png",
      buffer: Buffer.from(replacementImage),
    });
    await expect(page.locator(".object-hit").first()).toHaveAccessibleName(
      "Image: Replacement.png. Select to edit",
    );
    await expect(page.locator(".slide-image")).not.toHaveAttribute(
      "src",
      before,
    );
    await closePanel(page);
    await page.keyboard.press("Control+z");
    await expect(page.locator(".slide-image")).toHaveAttribute("src", before);
    await page.keyboard.press("Control+y");
    await expect(page.locator(".slide-image")).not.toHaveAttribute(
      "src",
      before,
    );
    const saved = await download(page),
      slides = P.getSlides(saved),
      edited = P.getSlideShapes(slides.at(-1));
    expect(P.getShapeImageBytes(edited[0])).toEqual(replacementImage);
    expect(P.getShapeImageBytes(edited[1])).toEqual(originalImage);
    expect(
      P.validatePresentation(saved).filter((i) => i.severity === "error"),
    ).toEqual([]);
    if (scenario === "duplicated slide") {
      for (const picture of P.getSlideShapes(slides[0]))
        expect(P.getShapeImageBytes(picture)).toEqual(originalImage);
      await navigate(page, 1);
      await expect(page.locator(".slide-image")).toHaveAttribute("src", before);
    }
  });
