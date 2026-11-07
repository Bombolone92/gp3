import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { P, createDeck, text } from "../src/model.js";

const fixture = (family = "Raleway") => {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  for (const [i, format] of [
    { font: family },
    { font: family, bold: true },
    { font: family, italic: true },
    {
      font: family === "Arial" ? "Arial" : "Playfair Display",
      italic: true,
      bold: true,
    },
  ].entries()) {
    const shape = text(slide, "Waffle ridge " + i, 1, 0.7 + i * 1.4, 10, 1, 44);
    P.setShapeTextFormat(shape, format);
  }
  return p;
};
async function start(page) {
  await page.addInitScript(() => {
    const NativeFace = window.FontFace;
    window.FontFace = class extends NativeFace {
      constructor(family, source, options) {
        super(family, source, options);
        this.localProbe =
          typeof source === "string" && source.startsWith("local(");
      }
      load() {
        return this.localProbe
          ? Promise.reject(new Error("No local custom fonts in this test"))
          : super.load();
      }
    };
  });
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
}
async function open(page, pres) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Font resources.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(await P.savePresentation(pres)),
  });
  await expect(page.locator(".object-hit")).toHaveCount(
    P.getSlideShapes(P.getSlides(pres)[0]).length,
  );
}
const svg = (page) =>
  page.locator(".slide-image").evaluate(async (img) => {
    await img.decode();
    return (await fetch(img.src)).text();
  });

test("uses the same supplied faces for measurement, SVG painting, clipboard and export", async ({
  page,
}) => {
  await start(page);
  const requested = [];
  page.on("request", (request) => {
    if (request.url().includes(".woff")) requested.push(request.url());
  });
  const presentation = fixture();
  // An earlier failed font download can leave fallback metrics in the shared
  // preview cache. Loading the actual faces must refresh that same measurer.
  await page.evaluate(
    async (bytes) => {
      const { P, preview } = await import("/src/model.js");
      const p = await P.loadPresentation(new Uint8Array(bytes));
      window.fontCacheProbe = p;
      preview(p, P.getSlides(p)[0]);
    },
    [...(await P.savePresentation(presentation))],
  );
  await open(page, presentation);
  const source = await svg(page);
  expect(requested).toHaveLength(8);
  expect(source.match(/@font-face/g)).toHaveLength(6);
  expect(source).toContain("data:font/woff2;base64,");
  const fresh = await page.evaluate(async () => {
    const { P } = await import("/src/model.js");
    const { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
    const { createTextMeasurer } = await import("/src/text-measure.js");
    const { slideFontResolver } = await import("/src/fonts.js");
    const { resolveFontKerning } = await import("/src/font-resources.js");
    const p = window.fontCacheProbe,
      slide = P.getSlides(p)[0];
    return renderSlideToSvg(p, slide, {
      preserveAspectRatio: "none",
      textLayout: "svg",
      stableDefinitionIds: true,
      gradientRendering: "css",
      measureText: createTextMeasurer(),
      resolveFontFamily: slideFontResolver(slide, p),
      resolveFontKerning,
    });
  });
  expect(source.replace(/<style>[\s\S]*?<\/style>/g, "")).toBe(fresh);
  const difference = await page.evaluate(async (source) => {
    const pixels = async (s) => {
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 1280, 720);
      return ctx.getImageData(0, 0, 1280, 720).data;
    };
    const a = await pixels(source);
    const b = await pixels(
      source
        .replace(/<style>[\s\S]*?<\/style>/g, "")
        .replaceAll("Raleway", "Arial")
        .replaceAll("Playfair Display", "Arial"),
    );
    let changed = 0;
    for (let i = 0; i < a.length; i += 4)
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])
        changed++;
    return changed;
  }, source);
  expect(difference).toBeGreaterThan(1000);
  await page.locator(".object-hit").first().click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".object-hit")).toHaveCount(5);
  await page.getByRole("button", { name: "Back to presentations" }).click();
  await page
    .getByRole("button", { name: "New presentation", exact: true })
    .click();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".object-hit")).toHaveCount(1);
  expect((await svg(page)).match(/@font-face/g)).toHaveLength(2);
  expect(requested).toHaveLength(8);
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .or(page.getByRole("button", { name: "File options" }))
    .filter({ visible: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download PowerPoint (.pptx)", exact: true })
    .click();
  const p = await P.loadPresentation(
    await readFile(await (await download).path()),
  );
  const shape = P.getSlideShapes(P.getSlides(p)[0])[0];
  expect(P.getShapeXmlString(shape)).toContain('typeface="Raleway"');
  expect(P.getShapeText(shape)).toBe("Waffle ridge 0");
});

test("does not fetch or embed font resources for ordinary system-font slides", async ({
  page,
}) => {
  await start(page);
  const requested = [];
  page.on("request", (request) => {
    if (request.url().includes(".woff")) requested.push(request.url());
  });
  await open(page, fixture("Arial"));
  expect(await svg(page)).not.toContain("@font-face");
  expect(requested).toHaveLength(0);
});

test("keeps static-face pair spacing consistent in canvas, DOM and SVG", async ({
  page,
}) => {
  await start(page);
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  let row = 0;
  for (const font of ["Raleway", "Playfair Display"])
    for (const bold of [false, true])
      for (const italic of [false, true]) {
        const shape = text(
          slide,
          "AVATAR To WA VA",
          1,
          0.2 + 0.8 * row++,
          10,
          0.7,
          24,
        );
        P.setShapeTextFormat(shape, { font, bold, italic });
      }
  await open(page, p);
  const source = await svg(page);
  const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  expect(css.match(/@font-face/g)).toHaveLength(8);
  const results = await page.evaluate(
    async ({ css, source }) => {
      const { default: catalog } = await import("/src/font-catalog.js");
      const { createTextMeasurer } = await import("/src/text-measure.js");
      const { resolveFontKerning } = await import("/src/font-resources.js");
      const measure = createTextMeasurer();
      const nodes = [
        ...new DOMParser()
          .parseFromString(source, "image/svg+xml")
          .querySelectorAll("tspan"),
      ];
      const inlineKerning =
        nodes.length === 8 &&
        nodes.every((node) => node.style.fontKerning === "none");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const text = "AVATAR To WA VA";
      const rows = [];
      const samples = [];
      for (const entry of catalog)
        for (const face of entry.faces) {
          const font = `${face.style} ${face.weight} 24px "${entry.family}"`;
          const spec = {
            family: `"${entry.family}", sans-serif`,
            sizePx: 24,
            bold: face.weight === "700",
            italic: face.style === "italic",
            letterSpacingPx: 0,
            kerning: "normal",
          };
          const normal = measure(text, spec).widthPx;
          const none = measure(text, { ...spec, kerning: "none" }).widthPx;
          const kerning = resolveFontKerning(spec);
          const span = document.createElement("span");
          Object.assign(span.style, {
            font,
            fontKerning: kerning,
            position: "absolute",
            whiteSpace: "pre",
          });
          span.textContent = text;
          document.body.append(span);
          const dom = span.getBoundingClientRect().width;
          // The original resource still contains functioning GPOS pair data.
          // The presentation's resolved kerning changes its use.
          const alias = `Unmodified font ${rows.length}`;
          const original = new FontFace(
            alias,
            await (await fetch(face.url)).arrayBuffer(),
            {
              style: face.style,
              weight: face.weight,
            },
          );
          await original.load();
          document.fonts.add(original);
          span.style.font = `${face.style} ${face.weight} 24px "${alias}"`;
          span.style.fontKerning = "normal";
          const originalNormal = span.getBoundingClientRect().width;
          span.style.fontKerning = "none";
          const originalNone = span.getBoundingClientRect().width;
          span.remove();
          document.fonts.delete(original);
          rows.push({
            family: entry.family,
            style: face.style,
            weight: face.weight,
            normal,
            none,
            dom,
            originalNormal,
            originalNone,
          });
          samples.push(
            `<text x="10" y="${30 + 35 * samples.length}" font-family="${entry.family}" font-style="${face.style}" font-weight="${face.weight}" font-size="24" style="font-kerning:${kerning}">${text}</text>`,
          );
        }
      const pixels = async (kerning) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><style>${css}</style><g style="font-kerning:${kerning}">${samples.join("")}</g></svg>`,
          );
        await image.decode();
        canvas.width = 400;
        canvas.height = 300;
        ctx.drawImage(image, 0, 0);
        return canvas.toDataURL();
      };
      return {
        rows,
        inlineKerning,
        normalSvg: await pixels("normal"),
        unkernedSvg: await pixels("none"),
      };
    },
    { css, source },
  );
  expect(results.rows).toHaveLength(8);
  expect(results.inlineKerning).toBe(true);
  for (const row of results.rows) {
    expect(row.normal, JSON.stringify(row)).toBeCloseTo(row.none, 4);
    expect(Math.abs(row.dom - row.normal), JSON.stringify(row)).toBeLessThan(
      0.1,
    );
    expect(
      Math.abs(row.originalNormal - row.originalNone),
      JSON.stringify(row),
    ).toBeGreaterThan(0.1);
  }
  if (results.normalSvg !== results.unkernedSvg)
    for (const name of ["normalSvg", "unkernedSvg"])
      await test.info().attach(name, {
        body: Buffer.from(results[name].split(",")[1], "base64"),
        contentType: "image/png",
      });
  expect(results.normalSvg === results.unkernedSvg).toBe(true);
  await page.locator(".object-hit").first().dblclick();
  const editor = page.getByRole("textbox", { name: "Edit text", exact: true });
  await expect(editor).toHaveCSS("font-kerning", "none");
  await expect(editor.locator("span").first()).toHaveCSS(
    "font-kerning",
    "none",
  );
  await editor.press("Escape");
});

test("keeps a presentation usable when font resources cannot load", async ({
  page,
}) => {
  await start(page);
  await page.route("**/*.woff2", (route) => route.abort());
  await open(page, fixture());
  const rendered = await svg(page);
  expect(rendered).toContain("Waffle ridge 0");
  expect(rendered).not.toContain("@font-face");
  await page.locator(".object-hit").first().click();
  await expect(page.locator(".object-hit.selected")).toHaveCount(1);
});
