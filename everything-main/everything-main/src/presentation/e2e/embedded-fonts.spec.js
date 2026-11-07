import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { P, createDeck, text } from "../src/model.js";

test("native font graph survives slide transfer and reload in both directions", async ({
  page,
}, testInfo) => {
  const source = createDeck("blank"),
    slide = P.getSlides(source)[0];
  for (const [i, [file, bold, italic]] of [
    ["Regular", false, false],
    ["Bold", true, false],
    ["Italic", false, true],
    ["BoldItalic", true, true],
  ].entries()) {
    const shape = text(slide, "AVAVA", 1, 1 + i * 1.1, 8, 1, 44);
    P.setShapeTextFormat(shape, {
      font: "Font Format Regression",
      bold,
      italic,
    });
    P.embedFont(
      source,
      new Uint8Array(
        readFileSync(
          new URL(`../tests/data/font-formats/${file}.ttf`, import.meta.url),
        ),
      ),
      { embeddingAuthorized: true },
    );
  }
  const input = await P.savePresentation(source);
  const sourcePath = testInfo.outputPath("native-font-source.pptx");
  writeFileSync(sourcePath, input);
  await testInfo.attach("native-font-source.pptx", {
    path: sourcePath,
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const result = await page.evaluate(
    async (input) => {
      const { P } = await import("/src/model.js");
      const { readEotFont, unmaskEotFontData } =
        await import("/lib/pptx/src/internal/fonts/index.ts");
      const source = await P.loadPresentation(new Uint8Array(input));
      const copy = (target, src) => {
        const s = P.getSlides(src)[0];
        const pasted = P.importSlide(
          target,
          s,
          P.importSlideTemplate(target, s),
          { preserveGeometry: false },
        );
        for (const old of P.getSlides(target))
          if (old !== pasted) P.removeSlide(target, old);
        P.importEmbeddedFonts(target, src, ["Font Format Regression"]);
      };
      const target = P.createPresentation();
      copy(target, source);
      const exportBytes = await P.savePresentation(target),
        reloaded = await P.loadPresentation(exportBytes);
      const back = P.createPresentation();
      copy(back, reloaded);
      const returnBytes = await P.savePresentation(back),
        returned = await P.loadPresentation(returnBytes);
      const fonts = (p) => P.getEmbeddedFonts(p)[0];
      const measurements = [];
      for (const style of ["regular", "bold", "italic", "boldItalic"]) {
        const before = fonts(source).faces[style],
          after = fonts(returned).faces[style];
        const descriptors = {
          weight: style === "bold" || style === "boldItalic" ? "700" : "400",
          style:
            style === "italic" || style === "boldItalic" ? "italic" : "normal",
        };
        for (const [family, face] of [
          ["Native source", before],
          ["Native return", after],
        ])
          document.fonts.add(
            await new FontFace(
              family,
              unmaskEotFontData(readEotFont(face.data).font),
              descriptors,
            ).load(),
          );
        const paint = (family) => {
          const c = document.createElement("canvas");
          c.width = 420;
          c.height = 130;
          const ctx = c.getContext("2d");
          ctx.font = `${descriptors.style} ${descriptors.weight} 100px "${family}"`;
          ctx.fillText("AVAVA", 10, 100);
          return {
            width: ctx.measureText("AVAVA").width,
            pixels: ctx.getImageData(0, 0, 420, 130).data,
          };
        };
        const a = paint("Native source"),
          b = paint("Native return");
        measurements.push({
          style,
          width: a.width,
          sameWidth: a.width === b.width,
          sameGlyphs: a.pixels.every((v, i) => v === b.pixels[i]),
          samePayload:
            before.data.length === after.data.length &&
            before.data.every((v, i) => v === after.data[i]),
        });
      }
      return {
        measurements,
        fonts: P.getSlideShapes(P.getSlides(returned)[0]).map((shape) =>
          P.getShapeRunFormatEffective(returned, shape, 0, 0),
        ),
        errors: [
          ...P.validatePresentation(reloaded),
          ...P.validatePresentation(returned),
        ],
        exportBytes: [...exportBytes],
        returnBytes: [...returnBytes],
      };
    },
    [...input],
  );
  expect(result.errors).toEqual([]);
  expect(result.fonts.map((f) => f.font)).toEqual(
    Array(4).fill("Font Format Regression"),
  );
  for (const m of result.measurements) {
    expect(m.sameWidth, m.style).toBe(true);
    expect(m.sameGlyphs, m.style).toBe(true);
    expect(m.samePayload, m.style).toBe(true);
    expect(m.width, m.style).toBe(
      m.style === "bold" || m.style === "boldItalic" ? 320 : 300,
    );
  }
  for (const [name, bytes] of [
    ["native-font-transfer.pptx", result.exportBytes],
    ["native-font-return.pptx", result.returnBytes],
  ]) {
    const artifactPath = testInfo.outputPath(name);
    writeFileSync(artifactPath, new Uint8Array(bytes));
    await testInfo.attach(name, {
      path: artifactPath,
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }
});
