import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import { showSelectionDeck } from "../tests/slide-show-fixture.js";

const counter = (page) => page.locator(".presenter-counter");
const image = (page) =>
  page.locator(".presenter-slide:not(.presenter-leaving)");
const notesButton = (page) =>
  page
    .locator(".presenter")
    .getByRole("button", { name: "Speaker notes", exact: true });
const notes = (page) => page.locator(".presenter-notes");

async function open(
  page,
  pres = showSelectionDeck("<p:sldAll/>", { attrs: 'useTimings="0"' }),
) {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
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
    name: "Keyboard navigation.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(pres)),
  });
  await expect(page.locator(".slide-image")).toBeVisible();
  await page.clock.pauseAt(new Date("2030-01-01T00:00:30Z"));
  await page.getByRole("button", { name: "Present", exact: true }).click();
  return pres;
}

const errors = new WeakMap();
test.beforeEach(({ page }) => {
  const seen = [];
  errors.set(page, seen);
  page.on("pageerror", (error) => seen.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

// N/P step forward/back through the show, including on macOS.
// Notes remain keyboard-accessible through their focusable toolbar button.
test("N and P navigate in either case while notes stay keyboard-accessible", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("n");
  await expect(counter(page)).toHaveText("2 / 5");
  await expect(notes(page)).toBeHidden();
  await page.keyboard.press("Shift+n");
  await expect(counter(page)).toHaveText("3 / 5");
  await page.keyboard.press("p");
  await expect(counter(page)).toHaveText("2 / 5");
  await page.keyboard.press("Shift+p");
  await expect(counter(page)).toHaveText("1 / 5");
  await page.keyboard.press("p");
  await expect(counter(page)).toHaveText("1 / 5");
  await notesButton(page).focus();
  await page.keyboard.press("Space");
  await expect(notes(page)).toBeVisible();
  await page.keyboard.press("n");
  await expect(counter(page)).toHaveText("2 / 5");
  await expect(notes(page)).toBeVisible();
  await expect(page.locator(".presenter-next-label")).toHaveText(/Slide 3:/);
  await notesButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(notes(page)).toBeHidden();
  await page.keyboard.press("End");
  await page.keyboard.press("n");
  await expect(page.locator(".presenter-end")).toBeVisible();
  await page.keyboard.press("p");
  await expect(image(page)).toHaveAttribute("alt", /Selected show slide 5/);
  await expect(counter(page)).toHaveText("5 / 5");
  await page.keyboard.press("n");
  await page.keyboard.press("n");
  await expect(page.locator(".presenter")).toHaveCount(0);
});

for (const custom of [false, true])
  test(`${custom ? "repeated custom shows" : "ranges with hidden slides"} use N/P to navigate the authored sequence`, async ({
    page,
  }) => {
    const pres = custom
      ? showSelectionDeck('<p:custShow id="7"/>', {
          attrs: 'useTimings="0" loop="1"',
          customShows: [{ id: 7, sequence: [3, 1, 3] }],
        })
      : showSelectionDeck('<p:sldRg st="2" end="5"/>', {
          attrs: 'useTimings="0"',
        });
    P.setSlideHidden(P.getSlides(pres)[custom ? 1 : 3], true);
    await open(page, pres);
    const order = custom ? [4, 2, 4] : [2, 3, 5];
    for (let i = 0; i < order.length; i++) {
      await expect(counter(page)).toHaveText(`${i + 1} / 3`);
      await expect(image(page)).toHaveAttribute(
        "alt",
        new RegExp(`Selected show slide ${order[i]}`),
      );
      if (i + 1 < order.length) await page.keyboard.press("n");
    }
    await page.keyboard.press("n");
    if (custom) {
      await expect(counter(page)).toHaveText("1 / 3");
      await page.keyboard.press("p");
    } else {
      await expect(page.locator(".presenter-end")).toBeVisible();
      await page.keyboard.press("p");
    }
    await expect(counter(page)).toHaveText("3 / 3");
    await page.keyboard.press("p");
    await expect(counter(page)).toHaveText("2 / 3");
    await expect(image(page)).toHaveAttribute(
      "alt",
      new RegExp(`Selected show slide ${order[1]}`),
    );
    await page.keyboard.press("p");
    await expect(counter(page)).toHaveText("1 / 3");
    await page.keyboard.press("p");
    await expect(counter(page)).toHaveText(custom ? "3 / 3" : "1 / 3");
  });

test("N/P reset the authored advance clock at the newly selected slide", async ({
  page,
}) => {
  await open(page, showSelectionDeck("<p:sldAll/>"));
  await page.clock.runFor(100);
  await page.keyboard.press("n");
  await expect(counter(page)).toHaveText("2 / 5");
  await page.clock.runFor(299);
  await expect(counter(page)).toHaveText("2 / 5");
  await page.clock.runFor(1);
  await expect(counter(page)).toHaveText("3 / 5");
  await page.clock.runFor(100);
  await page.keyboard.press("p");
  await expect(counter(page)).toHaveText("2 / 5");
  await page.clock.runFor(299);
  await expect(counter(page)).toHaveText("2 / 5");
  await page.clock.runFor(1);
  await expect(counter(page)).toHaveText("3 / 5");
});

test("N/P restore black and white screens and resume the selected slide's clock", async ({
  page,
}) => {
  await open(page, showSelectionDeck("<p:sldAll/>"));
  await page.keyboard.press("n");
  for (const [blank, key, index] of [
    ["b", "n", 3],
    ["w", "p", 3],
  ]) {
    await page.keyboard.press(blank);
    await expect(image(page)).toBeHidden();
    await page.clock.runFor(1000);
    await page.keyboard.press(key);
    await expect(image(page)).toBeVisible();
    await expect(counter(page)).toHaveText(`${index} / 5`);
    await page.clock.runFor(299);
    await expect(counter(page)).toHaveText(`${index} / 5`);
    await page.clock.runFor(1);
    await expect(counter(page)).toHaveText(`${index + 1} / 5`);
  }
});

test("letter navigation clears the laser dot and respects modified keys and toolbar activation", async ({
  page,
}) => {
  await open(page);
  const laser = page
    .locator(".presenter")
    .getByRole("button", { name: "Laser pointer", exact: true });
  await laser.click();
  const box = await page.locator(".presenter-frame").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".presenter-laser")).toBeVisible();
  await page.keyboard.press("n");
  await expect(counter(page)).toHaveText("2 / 5");
  await expect(page.locator(".presenter-laser")).toBeHidden();
  await expect(laser).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("p");
  await expect(counter(page)).toHaveText("1 / 5");
  await page.keyboard.press("Escape");
  for (const modifiers of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ])
    await image(page).dispatchEvent("keydown", {
      key: "n",
      bubbles: true,
      ...modifiers,
    });
  await image(page).dispatchEvent("keydown", {
    key: "p",
    bubbles: true,
    altKey: true,
  });
  await expect(counter(page)).toHaveText("1 / 5");
  for (const key of ["n", "p", "Escape"]) {
    await image(page).dispatchEvent("keydown", {
      key,
      bubbles: true,
      isComposing: true,
    });
    await expect(counter(page)).toHaveText("1 / 5");
  }
  await page
    .locator(".presenter")
    .getByRole("button", { name: "Next slide", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(counter(page)).toHaveText("2 / 5");
  await page
    .locator(".presenter")
    .getByRole("button", { name: "Previous slide", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(counter(page)).toHaveText("1 / 5");
});

test("keyboard navigation and notes controls preserve every authored slide and show property on UI export", async ({
  page,
}) => {
  const pres = await open(page);
  const before = unzipSync(await P.savePresentation(pres));
  await page.keyboard.press("n");
  await notesButton(page).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("p");
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
  const saved = new Uint8Array(await readFile(await (await pending).path())),
    after = unzipSync(saved);
  for (const name of Object.keys(before).filter(
    (name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name) ||
      ["ppt/presProps.xml", "ppt/presentation.xml"].includes(name),
  ))
    expect(after[name]).toEqual(before[name]);
  expect(P.getSlides(await parseDeck(saved))).toHaveLength(5);
});
