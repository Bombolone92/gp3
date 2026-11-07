import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

for (const backend of ["default", "WebGL"]) {
  test(`solid-gradient definitions retain precise settings through browser PSD/PSB encoding (${backend})`, async ({
    page,
  }) => {
    if (backend === "WebGL")
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined }),
      );
    await page.route("https://js.puter.com/**", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: "window.puter={};",
      }),
    );
    await page.goto("/");
    await expect(page.locator("#engine-status")).toHaveText(/WebGPU|WebGL2/);
    const fixtures = await Promise.all(
      ["GdFl", "vscg"].flatMap((key) =>
        [
          "zero",
          "fractional",
          "half",
          "full",
          "absent",
          "invalid-unit",
          "invalid-number",
          "invalid-location",
        ].map(async (label) => ({
          key,
          label,
          bytes: Array.from(
            await readFile(
              new URL(
                `../fixtures/psd-gradient-fills/${label}-${key}.psd`,
                import.meta.url,
              ),
            ),
          ),
        })),
      ),
    );
    const result = await page.evaluate(async (fixtures) => {
      const { readPsdWithPatternResources } =
        await import("/src/model/psd-patterns.ts");
      const { writePsdWithPreciseStrokes } =
        await import("/src/model/psd-stroke-writer.ts");
      const { writeHighDepthPsd } =
        await import("/src/model/psd-high-depth.ts");
      const options = {
        useRawData: true,
        skipCompositeImageData: true,
        skipThumbnail: true,
      };
      const same = (a, b) => {
        if (typeof a !== "object" || a === null || b === null)
          return Object.is(a, b);
        const keys = Object.keys(a);
        return (
          keys.length === Object.keys(b).length &&
          keys.every((key) => same(a[key], b[key]))
        );
      };
      const checks = [],
        errors = [],
        exports = [];
      for (const fixture of fixtures) {
        if (fixture.label.startsWith("invalid")) {
          try {
            readPsdWithPatternResources(new Uint8Array(fixture.bytes), options);
            errors.push("accepted malformed gradient");
          } catch (error) {
            errors.push(error.message);
          }
          continue;
        }
        const original = readPsdWithPatternResources(
          new Uint8Array(fixture.bytes),
          options,
        ).children[0].vectorFill;
        for (const depth of [8, 16, 32])
          for (const psb of [false, true]) {
            const psd = {
              width: 5,
              height: 3,
              bitsPerChannel: depth,
              imageData: {
                width: 5,
                height: 3,
                data:
                  depth === 8
                    ? new Uint8ClampedArray(60)
                    : depth === 16
                      ? new Uint16Array(60)
                      : new Float32Array(60),
              },
              children: [
                {
                  name: "Editable gradient",
                  vectorFill: structuredClone(original),
                  ...(fixture.key === "vscg"
                    ? {
                        vectorStroke: {
                          strokeEnabled: true,
                          fillEnabled: true,
                          opacity: 0.123456789,
                          lineWidth: { units: "Pixels", value: 1.25 },
                          content: {
                            type: "color",
                            color: { r: 21, g: 71, b: 161 },
                          },
                        },
                      }
                    : {}),
                },
              ],
            };
            const encode = () =>
              new Uint8Array(
                depth === 8
                  ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
                  : writeHighDepthPsd(psd, psb),
              );
            const output = encode(),
              decoded = readPsdWithPatternResources(output, options);
            const edited = structuredClone(original);
            edited.interpolationSamples = 2048.125;
            edited.scalePercent = 73.65432198765432;
            edited.offsetPercent = { x: -0, y: -987.1234567890123 };
            edited.angle = -0;
            edited.opacityStops[2].opacityPercent = Number.MIN_VALUE;
            edited.colorStops[1].location = 1023 / 4096;
            psd.children[0].vectorFill = edited;
            const changed = encode(),
              reopened = readPsdWithPatternResources(changed, options);
            checks.push(
              same(decoded.children[0].vectorFill, original) &&
                same(reopened.children[0].vectorFill, edited) &&
                decoded.bitsPerChannel === depth &&
                (fixture.key !== "vscg" ||
                  decoded.children[0].vectorStroke.opacity === 0.123456789),
            );
            const name = `${fixture.label}-${fixture.key}-${depth}.${psb ? "psb" : "psd"}`;
            exports.push(
              { name, bytes: Array.from(output) },
              { name: `edited-${name}`, bytes: Array.from(changed) },
            );
            if (fixture.label === "full") {
              const opaque = structuredClone(original);
              opaque.opacityStops = [];
              psd.children[0].vectorFill = opaque;
              const withoutVariations = encode();
              const expected = structuredClone(original);
              expected.opacityStops = [
                { location: 0, midpoint: 0.5, opacityPercent: 100 },
                { location: 1, midpoint: 0.5, opacityPercent: 100 },
              ];
              checks.push(
                same(
                  readPsdWithPatternResources(withoutVariations, options)
                    .children[0].vectorFill,
                  expected,
                ) && opaque.opacityStops.length === 0,
              );
              exports.push({
                name: `opaque-${name}`,
                bytes: Array.from(withoutVariations),
              });
            }
          }
      }
      return { checks, errors, exports };
    }, fixtures);
    expect(result.checks).toHaveLength(72);
    expect(result.checks.every(Boolean)).toBe(true);
    expect(result.errors).toHaveLength(6);
    expect(
      result.errors.every((message) => /Invalid PSD gradient/.test(message)),
    ).toBe(true);
    if (process.env.PHOTO_EDITOR_GRADIENT_EXPORTS) {
      const directory = path.join(
        path.resolve(process.env.PHOTO_EDITOR_GRADIENT_EXPORTS),
        backend,
      );
      await mkdir(directory, { recursive: true });
      for (const output of result.exports)
        await writeFile(
          path.join(directory, output.name),
          new Uint8Array(output.bytes),
        );
    }
  });
}
