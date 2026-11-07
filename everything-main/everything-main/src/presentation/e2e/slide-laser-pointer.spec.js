import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import {
  laserDeck,
  nextSlideLink,
  laserCompatibilityDeck,
} from "../tests/slide-laser-fixture.js";

const errors = new WeakMap();
test.beforeEach(({ page }) => {
  const failures = [];
  errors.set(page, failures);
  page.on("pageerror", (error) => failures.push(error.message));
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

async function open(page, pres = laserDeck(), { pauseClock = false } = {}) {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const choose = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await choose
  ).setFiles({
    name: "Laser pointer.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(pres)),
  });
  await expect(page.locator(".slide-image")).toBeVisible();
  if (pauseClock) await page.clock.pauseAt(new Date("2030-01-01T00:00:30Z"));
  await page.getByRole("button", { name: "Present", exact: true }).click();
}
const toggle = (page) =>
  page
    .locator(".presenter")
    .getByRole("button", { name: "Laser pointer", exact: true });
const dot = (page) => page.locator(".presenter-laser");
const counter = (page) => page.locator(".presenter-counter");
async function point(page, x = 0.35, y = 0.6) {
  const box = await page.locator(".presenter-frame").boundingBox();
  const position = { x: box.x + box.width * x, y: box.y + box.height * y };
  await page.mouse.move(position.x, position.y);
  return position;
}

test("a selected laser follows slide coordinates and does not advance the slide", async ({
  page,
}) => {
  await open(page);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  const position = await point(page);
  await expect(dot(page)).toBeVisible();
  await expect(dot(page)).toHaveCSS("background-color", "rgb(255, 0, 0)");
  await expect(dot(page)).toHaveCSS("left", /px$/);
  const center = await dot(page).boundingBox();
  expect(Math.abs(center.x + center.width / 2 - position.x)).toBeLessThan(1);
  expect(Math.abs(center.y + center.height / 2 - position.y)).toBeLessThan(1);
  await page.mouse.click(position.x, position.y);
  await expect(counter(page)).toHaveText("1 / 5");
  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("2 / 5");
  await expect(dot(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(counter(page)).toHaveText("2 / 5");
  const next = await point(page);
  await page.mouse.click(next.x, next.y);
  await expect(counter(page)).toHaveText("3 / 5");
});

test("authored laser color and alpha survive pointer use and UI export", async ({
  page,
}) => {
  const pres = laserDeck(
    '<a:srgbClr val="148A2B"><a:alpha val="50000"/></a:srgbClr>',
  );
  await open(page, pres);
  await toggle(page).click();
  await point(page);
  await expect(dot(page)).toHaveCSS("background-color", "rgb(20, 138, 43)");
  await expect(dot(page)).toHaveCSS("opacity", "0.5");
  await page.keyboard.press("Escape");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(counter(page)).toHaveText("1 / 5");
  await page.keyboard.press("Escape");
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const saved = new Uint8Array(await readFile(await (await pending).path()));
  const before = unzipSync(await P.savePresentation(pres)),
    after = unzipSync(saved);
  expect(after["ppt/presProps.xml"]).toEqual(before["ppt/presProps.xml"]);
  expect(after["ppt/presentation.xml"]).toEqual(before["ppt/presentation.xml"]);
  expect(P.getSlides(await parseDeck(saved))).toHaveLength(5);
});

test("Control pointing consumes linked clicks and release restores normal navigation", async ({
  page,
}) => {
  const pres = laserDeck();
  nextSlideLink(pres);
  await open(page, pres);
  const link = await page.locator(".presenter-link").boundingBox();
  await page.mouse.move(link.x + link.width / 2, link.y + link.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.down();
  await expect(dot(page)).toBeVisible();
  expect(
    await page.locator(".presenter-frame").evaluate((frame) => {
      const menu = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      });
      return !frame.dispatchEvent(menu);
    }),
  ).toBe(true);
  await page.mouse.move(link.x + link.width / 2 + 2, link.y + link.height / 2);
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect(dot(page)).toBeHidden();
  await expect(counter(page)).toHaveText("1 / 5");
  await page.locator(".presenter-link").click();
  await expect(counter(page)).toHaveText("2 / 5");
});

test("touch pointing consumes swipe events and cancellation restores a clean pointer", async ({
  page,
}) => {
  await open(page);
  await toggle(page).click();
  const frame = page.locator(".presenter-frame");
  const box = await frame.boundingBox();
  const start = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.5 },
    end = { x: box.x + box.width * 0.2, y: start.y };
  const input = await page.context().newCDPSession(page);
  await input.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 7 }],
  });
  await input.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...end, id: 7 }],
  });
  await expect(dot(page)).toBeVisible();
  await input.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(dot(page)).toBeHidden();
  await expect(counter(page)).toHaveText("1 / 5");
  await toggle(page).click();
  // A new ordinary gesture clears any cancelled pointing click suppression.
  await input.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 8 }],
  });
  await input.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...end, id: 8 }],
  });
  await input.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(counter(page)).toHaveText("2 / 5");
  await input.detach();
});

test("laser mode remains accessible after a notes resize and keyboard toggle", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("l");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await point(page);
  await page
    .getByRole("button", { name: "Speaker notes", exact: true })
    .click();
  await expect(dot(page)).toBeHidden();
  const position = await point(page, 0.6, 0.3);
  await expect(dot(page)).toBeVisible();
  const box = await dot(page).boundingBox();
  expect(Math.abs(box.x + box.width / 2 - position.x)).toBeLessThan(1);
  expect(Math.abs(box.y + box.height / 2 - position.y)).toBeLessThan(1);
  const audit = await new AxeBuilder({ page }).include(".presenter").analyze();
  expect(audit.violations).toEqual([]);
  await page.keyboard.press("l");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(dot(page)).toBeHidden();
});

test("blanking, end of show and close remove the pointer without leaking mode into another show", async ({
  page,
}) => {
  await open(page);
  await toggle(page).click();
  await point(page);
  await page.keyboard.press("b");
  await expect(dot(page)).toBeHidden();
  await page.keyboard.press("b");
  await point(page);
  await expect(dot(page)).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".presenter-end")).toBeVisible();
  await expect(dot(page)).toBeHidden();
  await page
    .locator(".presenter")
    .getByRole("button", { name: "Exit", exact: true })
    .click();
  await expect(dot(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await point(page);
  await expect(dot(page)).toBeHidden();
});

test("an invalid authored laser color reports an error while navigation stays available", async ({
  page,
}) => {
  await open(page, laserDeck('<a:srgbClr val="invalid"/>'));
  await toggle(page).click();
  await expect(
    page.getByText(/laser pointer color is invalid or unsupported/),
  ).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(dot(page)).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("2 / 5");
});

test("pointing leaves authored automatic advance running", async ({ page }) => {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await open(page, laserDeck(null, { timed: true }));
  await page.clock.pauseAt(new Date("2030-01-01T00:00:30Z"));
  // Import and presentation creation happened before the paused clock. Restart
  // at the first entry so this measures the authored delay from slide entry.
  await page.keyboard.press("Home");
  await toggle(page).click();
  await point(page);
  await page.clock.runFor(300);
  await expect(counter(page)).toHaveText("2 / 5");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(dot(page)).toBeHidden();
});

test("releasing Control before the mouse and losing window focus clear pointing without advancing", async ({
  page,
}) => {
  await open(page);
  const position = await point(page);
  await page.keyboard.down("Control");
  await page.mouse.down();
  await expect(dot(page)).toBeVisible();
  await page.keyboard.up("Control");
  await expect(dot(page)).toBeHidden();
  await page.mouse.up();
  await expect(counter(page)).toHaveText("1 / 5");
  await page.mouse.click(position.x, position.y);
  await expect(counter(page)).toHaveText("2 / 5");
  await toggle(page).click();
  await point(page);
  await expect(dot(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
  await expect(dot(page)).toBeHidden();
  await expect(counter(page)).toHaveText("2 / 5");
});

for (const unknown of [false, true])
  test(`laser color, range and loop agree on the ${unknown ? "fallback" : "understood modern"} show alternative`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
    await open(page, laserCompatibilityDeck(unknown), { pauseClock: true });
    await expect(counter(page)).toHaveText(unknown ? "1 / 5" : "1 / 3");
    await expect(
      page.locator(".presenter-slide:not(.presenter-leaving)"),
    ).toHaveAttribute(
      "alt",
      new RegExp(`Selected show slide ${unknown ? 1 : 2}`),
    );
    await toggle(page).click();
    await point(page);
    await expect(dot(page)).toHaveCSS(
      "background-color",
      unknown ? "rgb(255, 0, 0)" : "rgb(0, 128, 0)",
    );
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    if (unknown) await expect(page.locator(".presenter-end")).toBeVisible();
    else await expect(counter(page)).toHaveText("1 / 3");
  });
