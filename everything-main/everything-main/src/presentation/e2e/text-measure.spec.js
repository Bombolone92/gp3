import { test, expect } from "@playwright/test";
import nativeShaped from "../tests/data/text-shaped-ranges-native.json" with { type: "json" };

// Independent native expectations also expose existing font-backend gaps.
// The same three cases fail on the preceding commit; keep them visible here.
const nativeBackendGaps = {
  firefox: new Set([
    "Arial kerning disabled",
    "positive tracking",
    "tracking without kerning",
  ]),
};
for (const row of nativeShaped.cases)
  test(`complete shaped spans retain native line breaks: ${row.name}`, async ({
    page,
    browserName,
  }) => {
    await page.route("https://js.puter.com/v2/", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
      }),
    );
    await page.goto("/");
    const lines = await page.evaluate(async (input) => {
      const { createTextMeasurer } = await import("/src/text-measure.js");
      const { layoutCore } =
        await import("/lib/pptx-preview/src/text-layout.ts");
      return layoutCore(input, createTextMeasurer()).placements.map(
        ({ line }) => line.tokens.map((token) => token.text).join(""),
      );
    }, row.input);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => typeof line === "string")).toBe(true);
    // Only the native line-string assertion is expected to fail; a page or
    // measurement exception must remain an ordinary regression.
    test.fail(
      nativeBackendGaps[browserName]?.has(row.name) ?? false,
      "Existing fractional Canvas-width or cross-run shaping discrepancy; independently reproduced before this change",
    );
    expect(lines).toEqual(row.lines);
  });

test("font measurement preserves canvas widths and leaves the document unchanged", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createTextMeasurer } = await import("/src/text-measure.js");
    const measure = createTextMeasurer(),
      ctx = document.createElement("canvas").getContext("2d"),
      rows = [];
    const before = document.body.innerHTML;
    for (const family of ["Arial", "serif", "monospace"]) {
      const spec = {
        family,
        sizePx: 24,
        bold: false,
        italic: false,
        letterSpacingPx: 0,
      };
      ctx.font = `24px ${family}`;
      const first = measure("Hgp", spec),
        other = measure("日本語", spec),
        larger = measure("Hgp", { ...spec, sizePx: 48 });
      rows.push({
        width: first.widthPx,
        canvasWidth: ctx.measureText("Hgp").width,
        ascent: first.ascentPx,
        descent: first.descentPx,
        gap: first.lineGapPx,
        otherAscent: other.ascentPx,
        largerAscent: larger.ascentPx,
      });
    }
    return { rows, unchanged: document.body.innerHTML === before };
  });
  expect(result.unchanged).toBe(true);
  for (const row of result.rows) {
    expect(row.width).toBe(row.canvasWidth);
    expect(row.ascent).toBeGreaterThan(0);
    expect(row.descent).toBeGreaterThanOrEqual(0);
    expect(row.gap).toBeGreaterThanOrEqual(0);
    expect(row.otherAscent).toBe(row.ascent);
    expect(row.largerAscent).toBeCloseTo(row.ascent * 2);
  }
});

test("font heights agree with unclamped Canvas and CSS measurements", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createTextMeasurer } = await import("/src/text-measure.js");
    const measure = createTextMeasurer(),
      ctx = document.createElement("canvas").getContext("2d"),
      rows = [];
    const before = document.body.innerHTML;
    for (const family of ["Arial", "serif", "monospace"]) {
      for (const face of [
        { bold: false, italic: false },
        { bold: true, italic: false },
        { bold: false, italic: true },
      ]) {
        const font = `${face.italic ? "italic" : "normal"} ${face.bold ? "bold" : "normal"} 128px ${family}`;
        ctx.font = font;
        const reference = ctx.measureText("Hg");
        const probe = document.createElement("span");
        probe.style.cssText = `all:initial;display:inline-block;white-space:pre;font:${font};line-height:normal`;
        probe.textContent = "Hg";
        document.body.append(probe);
        let height;
        try {
          height = probe.getBoundingClientRect().height;
        } finally {
          probe.remove();
        }
        for (const sizePx of [13.33, 24, 48]) {
          const spec = { family, ...face, sizePx, letterSpacingPx: 0 };
          const measured = measure("Hgp", spec),
            other = measure("日本語", spec);
          rows.push({
            family,
            ...face,
            sizePx,
            measured,
            other,
            ascent: (reference.fontBoundingBoxAscent / 128) * sizePx,
            descent: (reference.fontBoundingBoxDescent / 128) * sizePx,
            height: (height / 128) * sizePx,
          });
        }
      }
    }
    return { rows, unchanged: document.body.innerHTML === before };
  });
  expect(result.unchanged).toBe(true);
  for (const row of result.rows) {
    // Direct 128px browser bounds round to pixels; normal CSS line boxes have
    // the same rounding limit. The reference does not reuse the calibrator.
    const pixel = row.sizePx / 128;
    expect(
      Math.abs(row.measured.ascentPx - row.ascent),
      JSON.stringify(row),
    ).toBeLessThanOrEqual(pixel);
    expect(
      Math.abs(row.measured.descentPx - row.descent),
      JSON.stringify(row),
    ).toBeLessThanOrEqual(pixel);
    expect(
      Math.abs(
        row.measured.ascentPx +
          row.measured.descentPx +
          row.measured.lineGapPx -
          row.height,
      ),
      JSON.stringify(row),
    ).toBeLessThanOrEqual(pixel);
    expect(row.other.ascentPx).toBe(row.measured.ascentPx);
    expect(row.other.descentPx).toBe(row.measured.descentPx);
  }
});

test("run kerning thresholds agree between canvas and both preview text paths", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const rows = await page.evaluate(async () => {
    const { P, createDeck } = await import("/src/model.js");
    const { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
    const { createTextMeasurer } = await import("/src/text-measure.js");
    const measure = createTextMeasurer(),
      rows = [];
    for (const kern of [0, 1200, 2000]) {
      const p = createDeck("blank"),
        s = P.getSlides(p)[0];
      const sh = P.addSlideTextBox(s, {
        x: 0,
        y: 0,
        w: P.inches(5),
        h: P.inches(2),
        text: "AVATAR",
      });
      P.setShapeTextFormat(sh, { font: "Arial", size: 18, kern });
      P.setShapeTextAutoFit(sh, "none");
      const spec = {
        family: "Arial",
        sizePx: 24,
        bold: false,
        italic: false,
        letterSpacingPx: 0,
        kerning: kern === 1200 ? "normal" : "none",
      };
      for (const textLayout of ["svg", "foreignObject"]) {
        const container = document.createElement("div");
        container.innerHTML = renderSlideToSvg(p, s, {
          textLayout,
          measureText: measure,
          resolveFontFamily: (f) => f || "Arial",
        });
        document.body.append(container);
        try {
          const element = [
            ...container.querySelectorAll(
              textLayout === "svg" ? "tspan" : "span",
            ),
          ].find((el) => el.textContent === "AVATAR");
          if (!element) throw Error("missing rendered text");
          const range = document.createRange();
          range.selectNodeContents(element);
          rows.push({
            kern,
            textLayout,
            kerning: getComputedStyle(element).fontKerning,
            width:
              textLayout === "svg"
                ? element.getComputedTextLength()
                : range.getBoundingClientRect().width /
                  container.querySelector("svg").getScreenCTM().a,
            measured: measure("AVATAR", spec).widthPx,
          });
        } finally {
          container.remove();
        }
      }
    }
    return rows;
  });
  for (const row of rows) {
    expect(row.kerning).toBe(row.kern === 1200 ? "normal" : "none");
    expect(
      Math.abs(row.width - row.measured),
      JSON.stringify(row),
    ).toBeLessThan(0.05);
  }
  expect(rows.find((r) => r.kern === 1200).measured).toBeLessThan(
    rows.find((r) => r.kern === 0).measured,
  );
  expect(rows.find((r) => r.kern === 2000).measured).toBe(
    rows.find((r) => r.kern === 0).measured,
  );
});

test("narrow text boxes keep zero-advance accents attached through PPTX round trips", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const rows = await page.evaluate(async () => {
    const { P, createDeck, parseDeck } = await import("/src/model.js");
    const { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
    const { createTextMeasurer } = await import("/src/text-measure.js");
    const measure = createTextMeasurer(),
      rows = [];
    // Native reference 18pt Arial controls preserve both decomposed accents at
    // 4pt and 12pt frame widths, including when the base glyph overflows.
    for (const cluster of [
      "e\u0301",
      "か\u3099",
      "👩🏽‍💻",
      "🇨🇦",
      "1️⃣",
      "각",
      "क्‍ष",
    ]) {
      for (const widthPt of [4, 12]) {
        const p = createDeck("blank"),
          s = P.getSlides(p)[0];
        const shape = P.addSlideTextBox(s, {
          x: 0,
          y: 0,
          w: widthPt * 12700,
          h: P.inches(2),
          text: cluster.repeat(2),
        });
        P.setShapeTextFormat(shape, { font: "Arial", size: 18, kern: 0 });
        P.setShapeTextMargins(shape, { left: 0, right: 0, top: 0, bottom: 0 });
        P.setShapeTextAutoFit(shape, "none");
        P.setShapeTextWrap(shape, "square");
        const lines = (deck) => {
          const svg = renderSlideToSvg(deck, P.getSlides(deck)[0], {
            textLayout: "svg",
            measureText: measure,
            resolveFontFamily: (family) => family || "Arial",
          });
          return [
            ...new DOMParser()
              .parseFromString(svg, "image/svg+xml")
              .querySelectorAll("text"),
          ].map((el) => el.textContent);
        };
        rows.push({
          cluster,
          widthPt,
          before: lines(p),
          after: lines(await parseDeck(await P.savePresentation(p))),
        });
      }
    }
    return rows;
  });
  for (const row of rows) {
    expect(row.before, JSON.stringify(row)).toEqual([row.cluster, row.cluster]);
    expect(row.after, JSON.stringify(row)).toEqual(row.before);
  }
});

test("formatted words retain native line breaks through export and copying", async ({
  page,
}) => {
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/");
  const rows = await page.evaluate(async () => {
    const { P, createDeck, parseDeck } = await import("/src/model.js");
    const { requireParagraph, runsOf } =
      await import("/lib/pptx/src/api/fn/shape-runs.ts");
    const { renderSlideToSvg } = await import("/lib/pptx-preview/src/index.ts");
    const { createTextMeasurer } = await import("/src/text-measure.js");
    const measure = createTextMeasurer(),
      rows = [];
    // Native reference controls: Arial18, 22mm content width, zero margins.
    // A bold suffix stays in gamma. Equal formatting must also stay intact.
    for (const bold of [false, true]) {
      const p = createDeck("blank"),
        s = P.getSlides(p)[0];
      const sh = P.addSlideTextBox(s, {
        x: 0,
        y: 0,
        w: 22 * 36000,
        h: 60 * 36000,
        text: "one ga",
      });
      P.setShapeTextFormat(sh, { font: "Arial", size: 18, kern: 0 });
      P.setShapeTextMargins(sh, { left: 0, right: 0, top: 0, bottom: 0 });
      P.setShapeTextAutoFit(sh, "none");
      P.setShapeTextWrap(sh, "square");
      const para = requireParagraph(sh, 0);
      para.children.push(structuredClone(runsOf(para)[0]));
      P.setShapeRunText(sh, 0, 1, "mma");
      P.setShapeRunFormat(sh, 0, 1, { bold });
      const lines = (deck, slide) => {
        const svg = renderSlideToSvg(deck, slide, {
          textLayout: "svg",
          measureText: measure,
          resolveFontFamily: (family) => family || "Arial",
        });
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        return {
          text: [...doc.querySelectorAll("text")].map((el) => el.textContent),
          bold: [...doc.querySelectorAll('tspan[font-weight="700"]')].map(
            (el) => el.textContent,
          ),
        };
      };
      const restored = await parseDeck(await P.savePresentation(p));
      const target = createDeck("blank");
      const copied = P.importSlide(
        target,
        P.getSlides(restored)[0],
        P.getSlideLayouts(target)[0],
      );
      rows.push({
        bold,
        before: lines(p, s),
        after: lines(restored, P.getSlides(restored)[0]),
        copied: lines(target, copied),
      });
    }
    return rows;
  });
  for (const row of rows) {
    expect(row.before.text).toEqual(["one", "gamma"]);
    expect(row.before.bold).toEqual(row.bold ? ["mma"] : []);
    expect(row.after).toEqual(row.before);
    expect(row.copied).toEqual(row.before);
  }
});
