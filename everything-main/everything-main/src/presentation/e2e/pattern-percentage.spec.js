import { test, expect } from "@playwright/test";

for (const gradientRendering of ["svg", "css"])
  test(`percentage pattern cells retain native density and physical pitch in ${gradientRendering}`, async ({
    page,
  }) => {
    await page.route("https://js.puter.com/v2/", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
      }),
    );
    await page.goto("/");
    const results = await page.evaluate(async (gradientRendering) => {
      const { P, createDeck } = await import("/src/model.js"),
        { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts"),
        out = [];
      for (const pct of [5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90]) {
        const p = createDeck("blank"),
          s = P.getSlides(p)[0];
        for (const [i, preset] of ["rect", "ellipse", "diamond"].entries()) {
          const sh = P.addSlideShape(s, {
            x: P.emu((96 + i * 317.5) * 9525),
            y: P.emu(96 * 9525),
            w: P.emu(192 * 9525),
            h: P.emu(192 * 9525),
            preset,
          });
          P.setShapePatternFill(sh, {
            preset: `pct${pct}`,
            foreground: "#000000",
            background: "#FFFFFF",
          });
        }
        const image = new Image();
        image.src = `data:image/svg+xml,${encodeURIComponent(renderSlideToSvg(p, s, { textLayout: "svg", gradientRendering }))}`;
        await image.decode();
        for (const scale of [1.5, 3]) {
          const c = document.createElement("canvas");
          c.width = 1280 * scale;
          c.height = 720 * scale;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, c.width, c.height);
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < 3; i++) {
            const startX = Math.floor(((192 + i * 317.5) * 72) / 96) - 8,
              startY = 136,
              values = [];
            let foreground = 0,
              maxEndpointError = 0;
            for (let y = 0; y < 16; y++)
              for (let x = 0; x < 16; x++) {
                const px = Math.floor((((startX + x + 0.5) * 96) / 72) * scale),
                  py = Math.floor((((startY + y + 0.5) * 96) / 72) * scale),
                  k = (py * c.width + px) * 4,
                  v = data[k];
                maxEndpointError = Math.max(
                  maxEndpointError,
                  Math.min(v, 255 - v),
                  Math.abs(v - data[k + 1]),
                  Math.abs(v - data[k + 2]),
                );
                foreground += v < 128 ? 1 : 0;
                values.push(v);
              }
            let repeatError = 0;
            for (let y = 0; y < 8; y++)
              for (let x = 0; x < 8; x++)
                for (const [dx, dy] of [
                  [8, 0],
                  [0, 8],
                  [8, 8],
                ])
                  repeatError = Math.max(
                    repeatError,
                    Math.abs(
                      values[y * 16 + x] - values[(y + dy) * 16 + x + dx],
                    ),
                  );
            out.push({
              pct,
              scale,
              shape: i,
              foreground,
              maxEndpointError,
              repeatError,
            });
          }
        }
      }
      return out;
    }, gradientRendering);
    const counts = {
      5: 2,
      10: 4,
      20: 8,
      25: 16,
      30: 24,
      40: 30,
      50: 32,
      60: 40,
      70: 48,
      75: 56,
      80: 60,
      90: 62,
    };
    for (const result of results) {
      const detail = JSON.stringify(result);
      expect(result.foreground, detail).toBe(counts[result.pct] * 4);
      expect(result.maxEndpointError, detail).toBeLessThanOrEqual(3);
      expect(result.repeatError, detail).toBeLessThanOrEqual(3);
    }
  });
