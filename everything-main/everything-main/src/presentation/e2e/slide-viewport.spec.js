import { test, expect } from "@playwright/test";
import { preview } from "../src/model.js";
import {
  slidePixelSizes,
  slideSvgSizeDeck,
} from "../tests/slide-svg-size-fixture.js";

for (const [width, height] of slidePixelSizes)
  test(`slide image ${width} by ${height} fills rounded destinations and remains aligned with normalized object coordinates`, async ({
    page,
  }) => {
    const { pres, slide } = slideSvgSizeDeck(width, height);
    const rows = await page.evaluate(
      async ({ src, width, height }) => {
        const rows = [];
        for (const [cssW, cssH] of [
          [911, 512.4375],
          [317.25, 238.5],
          [500, 500],
        ]) {
          const host = document.createElement("div");
          host.style.cssText = `position:relative;width:${cssW}px;height:${cssH}px`;
          const image = new Image();
          image.style.cssText =
            "position:absolute;inset:0;width:100%;height:100%";
          image.src = src;
          host.append(image);
          document.body.append(host);
          // Establish the displayed viewport before decoding, as in the editor.
          image.getBoundingClientRect();
          await image.decode();
          try {
            for (const scale of [1, 0.5, 2]) {
              const canvas = document.createElement("canvas");
              canvas.width = width * scale;
              canvas.height = height * scale;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
              const pixels = ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
              let translucent = 0;
              for (let i = 3; i < pixels.length; i += 4)
                if (pixels[i] !== 255) translucent++;
              const color = (x, y) => [
                ...ctx.getImageData(
                  Math.floor(x * canvas.width),
                  Math.floor(y * canvas.height),
                  1,
                  1,
                ).data,
              ];
              rows.push({
                cssW,
                cssH,
                scale,
                translucent,
                corners: [color(0, 0), color(0.999, 0.999)],
                inside: [
                  color(0.3, 0.5),
                  color(0.7, 0.5),
                  color(0.5, 0.3),
                  color(0.5, 0.7),
                ],
                outside: [
                  color(0.2, 0.5),
                  color(0.8, 0.5),
                  color(0.5, 0.2),
                  color(0.5, 0.8),
                ],
              });
            }
          } finally {
            host.remove();
          }
        }
        return rows;
      },
      { src: preview(pres, slide), width, height },
    );
    for (const row of rows) {
      expect(row.translucent, JSON.stringify(row)).toBe(0);
      expect(row.corners).toEqual([
        [255, 255, 255, 255],
        [255, 255, 255, 255],
      ]);
      expect(row.inside).toEqual(
        Array.from({ length: 4 }, () => [18, 103, 178, 255]),
      );
      expect(row.outside).toEqual(
        Array.from({ length: 4 }, () => [255, 255, 255, 255]),
      );
    }
  });
