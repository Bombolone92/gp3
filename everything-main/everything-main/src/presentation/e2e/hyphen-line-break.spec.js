import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, parseDeck } from "../src/model.js";
import {
  hyphenLineBreakCases,
  hyphenLineBreakFixture,
} from "../tests/hyphen-line-break-fixture.js";

async function importControl(page, bytes) {
  await page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
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
    name: "Line breaks.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator(".object-hit")).toHaveCount(
    hyphenLineBreakCases.length,
  );
}
const renderedLines = (page) =>
  page.locator(".slide-image").evaluate(async (img) => {
    await img.decode();
    const doc = new DOMParser().parseFromString(
      await (await fetch(img.src)).text(),
      "image/svg+xml",
    );
    return [...doc.querySelectorAll("g[data-pptx-shape-name]")].map((group) =>
      [...group.querySelectorAll("text")].map((text) => text.textContent),
    );
  });
async function download(page) {
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const saved = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  return parseDeck(await readFile(await (await saved).path()));
}

test("native ASCII hyphen and nonbreaking-space boundaries survive canvas, slideshow and PPTX download", async ({
  page,
}) => {
  const bytes = await P.savePresentation(await hyphenLineBreakFixture());
  await importControl(page, bytes);
  expect(await renderedLines(page)).toEqual(
    hyphenLineBreakCases.map((c) => c.lines),
  );
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".presenter-end")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".presenter-controls")).toContainText("1 / 1");
  await page.keyboard.press("Escape");
  const loaded = await download(page);
  expect(P.getSlideShapes(P.getSlides(loaded)[0]).map(P.getShapeText)).toEqual(
    hyphenLineBreakCases.map((c) => c.text),
  );
  await importControl(page, await P.savePresentation(loaded));
  expect(await renderedLines(page)).toEqual(
    hyphenLineBreakCases.map((c) => c.lines),
  );
});

test("hyphen break units survive object clipboard transfer in both directions", async ({
  page,
}) => {
  const bytes = await P.savePresentation(await hyphenLineBreakFixture());
  await importControl(page, bytes);
  const objects = page.locator(".object-hit");
  await objects.nth(0).click();
  await objects.nth(3).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(2);
  const expected = [hyphenLineBreakCases[0], hyphenLineBreakCases[3]];
  expect(await renderedLines(page)).toEqual(expected.map((c) => c.lines));
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+c");
  await importControl(page, bytes);
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(hyphenLineBreakCases.length + 2);
  expect((await renderedLines(page)).slice(-2)).toEqual(
    expected.map((c) => c.lines),
  );
  const loaded = await download(page);
  expect(
    P.getSlideShapes(P.getSlides(loaded)[0]).slice(-2).map(P.getShapeText),
  ).toEqual(expected.map((c) => c.text));
});
