import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { P, createDeck, text } from "../src/model.js";
import AxeBuilder from "@axe-core/playwright";
import { metadataFont } from "../tests/font-format-fixture.js";
import { embedMtxFont } from "../tests/mtx-font-fixture.js";
const family = "Font Format Regression";
const bytes = (style) =>
  new Uint8Array(
    readFileSync(
      new URL(`../tests/data/font-formats/${style}.ttf`, import.meta.url),
    ),
  );
function fixture(
  styles = ["Regular", "Bold", "Italic", "BoldItalic"],
  compressed = false,
) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  styles.forEach((style, i) => {
    if (compressed) embedMtxFont(p, style);
    else P.embedFont(p, bytes(style), { embeddingAuthorized: true });
    const shape = text(slide, "AVAVA", 1, 0.8 + i * 1.2, 8, 1, 44);
    P.setShapeTextFormat(shape, {
      font:
        style === "CFF"
          ? `${family} CFF`
          : style === "Plus"
            ? `+${family}`
            : family,
      bold: style.includes("Bold"),
      italic: style.includes("Italic"),
    });
  });
  return p;
}
async function start(page) {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
}
async function open(
  page,
  p,
  name = "Native fonts.pptx",
  selector = ".object-hit",
  count = P.getSlideShapes(P.getSlides(p)[0]).length,
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(p)),
  });
  await expect(page.locator(selector)).toHaveCount(count);
}
const svg = (page) =>
  page.locator(".slide-image").evaluate(async (img) => {
    await img.decode();
    return (await fetch(img.src)).text();
  });
const fonts = (page) =>
  page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.family.includes("Presentation document font"))
      .map((face) => ({
        family: face.family,
        style: face.style,
        weight: face.weight,
      })),
  );
async function attachNative(testInfo, name, bytes) {
  const path = testInfo.outputPath(name);
  writeFileSync(path, bytes);
  await testInfo.attach(name, {
    path,
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
async function download(page, testInfo = null, name = null) {
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const result = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const bytes = await readFile(await (await result).path());
  if (testInfo) await attachNative(testInfo, name, bytes);
  return P.loadPresentation(bytes);
}
const encodedFonts = (p) =>
  P.getEmbeddedFonts(p).map((font) => ({
    typeface: font.typeface,
    faces: Object.fromEntries(
      Object.entries(font.faces).map(([style, face]) => [
        style,
        [...face.data],
      ]),
    ),
  }));
const pixels = (page, source) =>
  page.evaluate(async (source) => {
    const image = new Image();
    image.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    canvas.getContext("2d").drawImage(image, 0, 0, 1280, 720);
    const data = canvas.getContext("2d").getImageData(0, 0, 1280, 720).data;
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }, source);

for (const compressed of [false, true])
  test(`the editor keeps ${compressed ? "MTX" : "native"} faces through clipboard, history, export and reimport in both directions`, async ({
    page,
  }, testInfo) => {
    await start(page);
    const source = fixture(undefined, compressed);
    await attachNative(
      testInfo,
      `document-font-${compressed ? "mtx-" : ""}source.pptx`,
      await P.savePresentation(source),
    );
    await open(page, source);
    const original = await svg(page);
    expect(original.match(/@font-face/g)).toHaveLength(4);
    expect(original).toContain("data:font/ttf");
    expect(await fonts(page)).toHaveLength(4);
    const originalPixels = await pixels(page, original);
    await page.locator(".object-hit").first().click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    expect(await fonts(page)).toHaveLength(0);
    // Saved SVGs carry their own face bytes; closing the originating document
    // cannot turn an already-rendered thumbnail into a fallback image.
    expect(await pixels(page, original)).toEqual(originalPixels);
    await page
      .getByRole("button", { name: "New presentation", exact: true })
      .click();
    await page.keyboard.press("Control+v");
    await expect(page.locator(".object-hit")).toHaveCount(4);
    expect(await pixels(page, await svg(page))).toEqual(originalPixels);
    expect(await fonts(page)).toHaveLength(4);
    await page.keyboard.press("Control+z");
    await expect(page.locator(".object-hit")).toHaveCount(0);
    expect(await fonts(page)).toHaveLength(0);
    await page.keyboard.press("Control+y");
    await expect(page.locator(".object-hit")).toHaveCount(4);
    expect(await fonts(page)).toHaveLength(4);
    expect(await pixels(page, await svg(page))).toEqual(originalPixels);
    const exported = await download(
      page,
      testInfo,
      `document-font-${compressed ? "mtx-" : ""}transfer.pptx`,
    );
    expect(encodedFonts(exported)).toEqual(encodedFonts(source));
    expect(P.validatePresentation(exported)).toEqual([]);
    expect(
      P.getSlideShapes(P.getSlides(exported)[0]).map(
        (shape) => P.getShapeRunFormatEffective(exported, shape, 0, 0).font,
      ),
    ).toEqual(Array(4).fill(family));
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await open(page, exported, "Exported fonts.pptx");
    expect(await pixels(page, await svg(page))).toEqual(originalPixels);
    await page.locator(".object-hit").first().click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await open(page, source, "Return fonts.pptx");
    await page.keyboard.press("Control+v");
    await expect(page.locator(".object-hit")).toHaveCount(8);
    const returned = await download(
      page,
      testInfo,
      `document-font-${compressed ? "mtx-" : ""}return.pptx`,
    );
    expect(encodedFonts(returned)).toEqual(encodedFonts(source));
    expect(P.validatePresentation(returned)).toEqual([]);
    expect(await fonts(page)).toHaveLength(4);
  });

test("inline text editing, DOM metrics and SVG use the loaded native family", async ({
  page,
}) => {
  await start(page);
  await open(page, fixture(["Regular"]));
  const measured = await page.evaluate(() => {
    const face = [...document.fonts].find((face) =>
      face.family.includes("Presentation document font"),
    );
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `100px "${face.family}"`;
    return ctx.measureText("AVAVA").width;
  });
  expect(measured).toBe(300);
  await page.locator(".object-hit").first().dblclick();
  await expect(page.locator(".inline-editor")).toBeVisible();
  expect(
    await page
      .locator(".inline-editor")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Presentation document font");
  await expect(page.locator(".inline-editor")).toHaveCSS(
    "font-kerning",
    "none",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
});

test("loads CFF outlines in both canvas and standalone SVG without converting the font", async ({
  page,
}) => {
  await start(page);
  const p = fixture(["CFF"]);
  await open(page, p);
  const source = await svg(page);
  expect(source).toContain("data:font/otf");
  expect(source).toContain('format("opentype")');
  const measured = await page.evaluate(() => {
    const face = [...document.fonts].find((face) =>
      face.family.includes("Presentation document font"),
    );
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `100px "${face.family}"`;
    return ctx.measureText("AVAVA").width;
  });
  expect(measured).toBe(300);
  expect(await pixels(page, source)).not.toEqual(
    await pixels(page, source.replace(/<style>[\s\S]*?<\/style>/g, "")),
  );
  expect(encodedFonts(await download(page))).toEqual(encodedFonts(p));
});

for (const compressed of [false, true])
  test(`${compressed ? "MTX" : "preview-print"} fonts open in an accessible view-only document and export intact`, async ({
    page,
  }) => {
    await start(page);
    const p = fixture(["PreviewPrint"], compressed);
    P.importSlide(p, P.getSlides(p)[0], P.getSlideLayouts(p)[0]);
    await open(page, p, "View only.pptx", ".font-viewer-stage", 1);
    await expect(
      page.getByText(
        "View only. An embedded font permits viewing and printing, but not editing this presentation.",
      ),
    ).toBeVisible();
    await expect(
      page.locator(".object-hit,.toolbar-tools,#speaker-notes,.inline-editor"),
    ).toHaveCount(0);
    expect(await fonts(page)).toHaveLength(1);
    expect(await svg(page)).toContain("@font-face");
    expect(
      (
        await new AxeBuilder({ page })
          .include(".font-viewer")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Next slide", exact: true }).click();
    await expect(page.locator(".font-viewer").getByRole("status")).toHaveText(
      "Slide 2 of 2",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".font-viewer").getByRole("status")).toHaveText(
      "Slide 1 of 2",
    );
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Delete");
    await expect(page.locator(".object-hit")).toHaveCount(0);
    const result = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download PowerPoint", exact: true })
      .click();
    const exported = await P.loadPresentation(
      await readFile(await (await result).path()),
    );
    expect(encodedFonts(exported)).toEqual(encodedFonts(p));
    expect(P.getShapeText(P.getSlideShapes(P.getSlides(exported)[0])[0])).toBe(
      "AVAVA",
    );
    await page.getByRole("button", { name: "Present", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Presentation mode" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    expect(await fonts(page)).toHaveLength(0);
  });

test("reports failed native families without replacing them with the packaged font catalog", async ({
  page,
}) => {
  await start(page);
  const p = fixture(["Regular"]);
  const part = P._internalPackageOf(p).getPart(
    P.getEmbeddedFonts(p)[0].faces.regular.partName,
  );
  part.data = new Uint8Array([1, 2, 3]);
  await open(page, p);
  await expect(page.locator("#font-load-notice summary")).toBeVisible();
  await page.locator("#font-load-notice summary").click();
  await expect(page.locator("#font-load-notice")).toContainText(family);
  expect(await fonts(page)).toHaveLength(0);
  expect(encodedFonts(await download(page))).toEqual(encodedFonts(p));
});

test("keeps different versions of the same authored family isolated between documents", async ({
  page,
}) => {
  await start(page);
  const a = fixture(["Regular"]),
    b = fixture(["Wide"]);
  const result = await page.evaluate(
    async (inputs) => {
      const { P, prepareDeckFonts, preview } = await import("/src/model.js");
      const { slideFontResolver } = await import("/src/fonts.js");
      const { disposeDocumentFonts } =
        await import("/src/document-font-resources.js");
      const docs = await Promise.all(
        inputs.map((input) => P.loadPresentation(new Uint8Array(input))),
      );
      await Promise.all(docs.map((doc) => prepareDeckFonts(doc)));
      const measure = (p) => {
        const family = slideFontResolver(
          P.getSlides(p)[0],
          p,
        )("Font Format Regression");
        const ctx = document.createElement("canvas").getContext("2d");
        ctx.font = `100px ${family}`;
        return ctx.measureText("AVAVA").width;
      };
      const before = docs.map(measure),
        rendered = docs.map((p) => preview(p, P.getSlides(p)[0]));
      const authoredFaces = [...document.fonts].filter(
        (face) => face.family === "Font Format Regression",
      ).length;
      disposeDocumentFonts(docs[0]);
      const after = measure(docs[1]);
      disposeDocumentFonts(docs[1]);
      return {
        before,
        after,
        authoredFaces,
        rendered,
        remaining: [...document.fonts].filter((face) =>
          face.family.includes("Presentation document font"),
        ).length,
      };
    },
    await Promise.all(
      [a, b].map(async (p) => [...(await P.savePresentation(p))]),
    ),
  );
  expect(result.before).toEqual([300, 450]);
  expect(result.after).toBe(450);
  expect(result.authoredFaces).toBe(0);
  expect(result.remaining).toBe(0);
  expect(result.rendered[0]).not.toBe(result.rendered[1]);
});

test("a cancelled open never publishes fonts into the next document", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeFace = window.FontFace;
    window.nativeFontGates = [];
    window.FontFace = class extends NativeFace {
      async load() {
        const face = await super.load();
        if (!this.family.includes("Presentation document font")) return face;
        return new Promise((resolve) =>
          window.nativeFontGates.push(() => resolve(face)),
        );
      }
    };
  });
  await start(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Cancelled font open.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(fixture())),
  });
  await expect
    .poll(() => page.evaluate(() => window.nativeFontGates.length))
    .toBe(4);
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(1);
  await expect(page.locator(".object-hit")).toHaveCount(0);
  await page.evaluate(async () => {
    window.nativeFontGates.forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(await fonts(page)).toHaveLength(0);
  await expect(page.locator(".object-hit")).toHaveCount(0);
  expect(await svg(page)).not.toContain("@font-face");
});

test("copies valid selected families when an unrelated embedded family is damaged", async ({
  page,
}) => {
  await start(page);
  const p = fixture();
  P.embedFont(p, metadataFont({ family: "Unselected broken family" }), {
    embeddingAuthorized: true,
  });
  const missing = P.getEmbeddedFonts(p).find(
    (font) => font.typeface === "Unselected broken family",
  ).faces.regular;
  P._internalPackageOf(p).removePart(missing.partName);
  await open(page, p);
  await expect(page.locator("#font-load-notice summary")).toBeVisible();
  expect(await fonts(page)).toHaveLength(4);
  await page.locator(".object-hit").first().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".object-hit")).toHaveCount(4);
  expect(await fonts(page)).toHaveLength(4);
  await expect(page.locator("#font-load-notice")).toBeHidden();
  const exported = await download(page);
  expect(P.getEmbeddedFonts(exported).map((font) => font.typeface)).toEqual([
    family,
  ]);
  expect(P.validatePresentation(exported)).toEqual([]);
});

test("retains the available native face in standalone SVG for synthesized styles", async ({
  page,
}) => {
  await start(page);
  const p = fixture(["Regular"]);
  P.setShapeTextFormat(P.getSlideShapes(P.getSlides(p)[0])[0], {
    bold: true,
    italic: true,
  });
  await open(page, p);
  const source = await svg(page);
  expect(source.match(/@font-face/g)).toHaveLength(1);
  expect(source).toContain("font-style:normal;font-weight:400");
  expect(source).toContain('font-weight="700"');
  expect(source).toContain('font-style="italic"');
  expect(await pixels(page, source)).not.toEqual(
    await pixels(page, source.replace(/<style>[\s\S]*?<\/style>/g, "")),
  );
});

test("a running slideshow retains its captured fonts when a pending import replaces the editor", async ({
  page,
}) => {
  await start(page);
  const source = fixture();
  P.importSlide(source, P.getSlides(source)[0], P.getSlideLayouts(source)[0]);
  await open(page, source);
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = read;
      return new Promise(
        (resolve) =>
          (window.releaseFontImport = async () =>
            resolve(await read.call(this))),
      );
    };
  });
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Import PPTX", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "Incoming wide fonts.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(fixture(["Wide"]))),
  });
  await page.waitForFunction(() => window.releaseFontImport);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.locator(".presenter-controls")).toContainText("1 / 2");
  const first = await page.locator(".presenter-slide").getAttribute("src");
  await page.evaluate(() => window.releaseFontImport());
  await expect(page.locator(".document-title")).toHaveText(
    "Incoming wide fonts",
  );
  expect(await fonts(page)).toHaveLength(5);
  await page.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(page.locator(".presenter-controls")).toContainText("2 / 2");
  const second = await page.locator(".presenter-slide").getAttribute("src");
  expect(
    await pixels(
      page,
      decodeURIComponent(second.split(",").slice(1).join(",")),
    ),
  ).toBe(
    await pixels(page, decodeURIComponent(first.split(",").slice(1).join(","))),
  );
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  expect(await fonts(page)).toHaveLength(1);
  await expect(page.locator(".object-hit")).toHaveCount(1);
  await page.getByRole("button", { name: "Back to presentations" }).click();
  expect(await fonts(page)).toHaveLength(0);
});

test("literal plus-prefixed families retain their actual faces through the object clipboard", async ({
  page,
}) => {
  await start(page);
  const p = fixture(["Plus"]);
  await open(page, p);
  const source = await svg(page);
  expect(source).toContain("@font-face");
  const before = await pixels(page, source);
  await page.locator(".object-hit").first().click();
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".object-hit")).toHaveCount(1);
  expect(await fonts(page)).toHaveLength(1);
  expect(await pixels(page, await svg(page))).toBe(before);
  const exported = await download(page);
  expect(encodedFonts(exported)).toEqual(encodedFonts(p));
  expect(
    P.getShapeRunFormatEffective(
      exported,
      P.getSlideShapes(P.getSlides(exported)[0])[0],
      0,
      0,
    ).font,
  ).toBe(`+${family}`);
});
