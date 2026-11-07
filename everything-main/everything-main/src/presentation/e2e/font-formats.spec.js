import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mtxFont, mtxEot } from "../tests/mtx-font-fixture.js";

test("native EOT font payloads preserve all four faces and browser glyphs", async ({
  page,
}) => {
  const files = ["Regular", "Bold", "Italic", "BoldItalic"].map((style) => ({
    style,
    bytes: [
      ...readFileSync(
        new URL(`../tests/data/font-formats/${style}.ttf`, import.meta.url),
      ),
    ],
  }));
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const result = await page.evaluate(async (files) => {
    const { readOpenTypeFont, readEotFont, writeEotFont, unmaskEotFontData } =
      await import("/lib/pptx/src/internal/fonts/index.ts");
    const inputs = [];
    for (const file of files) {
      const bytes = new Uint8Array(file.bytes),
        info = readOpenTypeFont(bytes);
      const data = unmaskEotFontData(
        readEotFont(writeEotFont(bytes, { embeddingAuthorized: true })).font,
      );
      const descriptors = {
        style: info.italic ? "italic" : "normal",
        weight: info.bold ? "700" : "400",
      };
      for (const [family, input] of [
        ["Before EOT", bytes],
        ["After EOT", data],
      ]) {
        const face = await new FontFace(family, input, descriptors).load();
        document.fonts.add(face);
      }
      inputs.push({ style: file.style, info });
    }
    const paint = (family, info) => {
      const canvas = document.createElement("canvas");
      canvas.width = 420;
      canvas.height = 130;
      const context = canvas.getContext("2d");
      context.font = `${info.italic ? "italic" : "normal"} ${info.bold ? "700" : "400"} 100px "${family}"`;
      context.fillText("AVAVA", 10, 100);
      return {
        width: context.measureText("AVAVA").width,
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    };
    return inputs.map(({ style, info }) => {
      const source = paint("Before EOT", info),
        copy = paint("After EOT", info);
      return {
        style,
        before: source.width,
        after: copy.width,
        expected: info.bold ? 320 : 300,
        pixelsEqual: source.pixels.every(
          (value, i) => value === copy.pixels[i],
        ),
        hasInk: copy.pixels.some((value) => value !== 0),
      };
    });
  }, files);
  for (const face of result) {
    expect(face.before, face.style).toBeCloseTo(face.expected, 3);
    expect(face.after, face.style).toBe(face.before);
    expect(face.pixelsEqual, face.style).toBe(true);
    expect(face.hasInk, face.style).toBe(true);
  }
});

test("MTX outlines and native hint programs paint identically at multiple pixel sizes", async ({
  page,
}) => {
  const names = [
      "Regular",
      "Bold",
      "Italic",
      "BoldItalic",
      "PreviewPrint",
      "Wide",
      "Plus",
      "Complex",
      "ComplexOffsets",
      "ComplexRawMetrics",
    ],
    files = names.map((name) => ({
      name,
      native: [...mtxFont(name, "ttf")],
      eot: [...mtxEot(name)],
    }));
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const reports = await page.evaluate(async (files) => {
    const { readOpenTypeFont, readEotFont, unmaskEotFontData, decodeMtxFont } =
        await import("/lib/pptx/src/internal/fonts/index.ts"),
      reports = [];
    for (const file of files) {
      const original = new Uint8Array(file.native),
        container = new Uint8Array(file.eot),
        before = container.slice(),
        eot = readEotFont(container),
        rebuilt = decodeMtxFont(unmaskEotFontData(eot.font)),
        info = readOpenTypeFont(original),
        descriptors = {
          style: info.italic ? "italic" : "normal",
          weight: info.bold ? "700" : "400",
        },
        nativeName = `Original MTX fixture ${file.name}`,
        decodedName = `Decoded MTX fixture ${file.name}`;
      const originalFace = await new FontFace(
          nativeName,
          original,
          descriptors,
        ).load(),
        decodedFace = await new FontFace(
          decodedName,
          rebuilt,
          descriptors,
        ).load();
      document.fonts.add(originalFace);
      document.fonts.add(decodedFace);
      for (const size of [11, 17, 41, 120]) {
        const paint = (family) => {
          const canvas = document.createElement("canvas");
          canvas.width = 1800;
          canvas.height = 220;
          const context = canvas.getContext("2d");
          context.font = `${descriptors.style} ${descriptors.weight} ${size}px "${family}"`;
          const text = file.name.startsWith("Complex") ? "AV CD SXMN" : "AVAVA";
          context.fillText(text, 20, 170);
          return {
            width: context.measureText(text).width,
            pixels: context.getImageData(0, 0, canvas.width, canvas.height)
              .data,
          };
        };
        const a = paint(nativeName),
          b = paint(decodedName);
        reports.push({
          name: file.name,
          size,
          sameWidth: a.width === b.width,
          samePixels: a.pixels.every((v, i) => v === b.pixels[i]),
          hasInk: b.pixels.some((v) => v),
        });
      }
      if (container.some((v, i) => v !== before[i]))
        throw Error("encoded font changed");
      document.fonts.delete(originalFace);
      document.fonts.delete(decodedFace);
    }
    return reports;
  }, files);
  expect(reports).toHaveLength(40);
  for (const report of reports)
    expect(report, `${report.name} at ${report.size}px`).toMatchObject({
      sameWidth: true,
      samePixels: true,
      hasInk: true,
    });
});
