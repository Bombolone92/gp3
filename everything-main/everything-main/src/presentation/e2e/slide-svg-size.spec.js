import { test, expect } from "@playwright/test";
import { preview } from "../src/model.js";
import {
  slidePixelSizes,
  slideSvgSizeDeck,
} from "../tests/slide-svg-size-fixture.js";

for (const [width, height] of slidePixelSizes)
  test(`native slide SVG ${width} by ${height} decodes and rasterizes without a CSS sizing context`, async ({
    page,
  }) => {
    const { pres, slide } = slideSvgSizeDeck(width, height),
      src = preview(pres, slide);
    const result = await page.evaluate(
      async ({ src, width, height }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const rows = [];
        // Include odd-height reductions whose integer raster extents round
        // independently. Preview coordinates still fill the whole destination.
        for (const scale of [1, 0.2, 0.5, 2]) {
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
            translucent,
            corners: [color(0, 0), color(0.99, 0.99)],
            center: color(0.5, 0.5),
            outside: color(0.1, 0.5),
          });
        }
        return { naturalSize: [image.naturalWidth, image.naturalHeight], rows };
      },
      { src, width, height },
    );
    expect(result.naturalSize).toEqual([width, height]);
    for (const row of result.rows) {
      expect(row.translucent).toBe(0);
      expect(row.corners).toEqual([
        [255, 255, 255, 255],
        [255, 255, 255, 255],
      ]);
      expect(row.center).toEqual([18, 103, 178, 255]);
      expect(row.outside).toEqual([255, 255, 255, 255]);
    }
  });
