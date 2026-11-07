import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("MTX streams decode losslessly with browser typed arrays and bounded output", async ({
  page,
}) => {
  const { vectors } = JSON.parse(
    readFileSync(
      new URL("../tests/fixtures/fonts/mtx-vectors.json", import.meta.url),
      "utf8",
    ),
  );
  await page.route("https://js.puter.com/v2/", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const result = await page.evaluate(async (vectors) => {
    const { decompressMtxStreams } =
        await import("/lib/pptx/src/internal/fonts/mtx-lzcomp.ts"),
      { FontFormatError } =
        await import("/lib/pptx/src/internal/fonts/binary.ts");
    const font = (vector) => {
      const block = Uint8Array.from(atob(vector.compressed), (c) =>
          c.charCodeAt(0),
        ),
        bytes = new Uint8Array(18 + block.length),
        set24 = (at, value) => {
          bytes[at] = value >>> 16;
          bytes[at + 1] = value >>> 8;
          bytes[at + 2] = value;
        };
      bytes[0] = 3;
      set24(1, vector.copyLimit);
      set24(4, 10 + block.length);
      set24(7, 14 + block.length);
      bytes.set(block, 10);
      return bytes;
    };
    const reports = [];
    for (const vector of vectors) {
      const input = font(vector),
        original = input.slice();
      try {
        const decoded = decompressMtxStreams(input),
          hash = new Uint8Array(
            await crypto.subtle.digest("SHA-256", decoded[0]),
          );
        reports.push({
          name: vector.name,
          length: decoded[0].length,
          sha256: [...hash]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join(""),
          emptySecondary: !decoded[1].length && !decoded[2].length,
        });
        decoded[0].fill(0);
      } catch (error) {
        reports.push({
          name: vector.name,
          formatError: error instanceof FontFormatError,
        });
      }
      if (input.some((v, i) => v !== original[i]))
        throw Error("compressed data was mutated");
    }
    let limited = false;
    try {
      decompressMtxStreams(
        font(vectors.find((v) => v.name === "long run-length expansion")),
        { maxDecodedBytes: 19999 },
      );
    } catch (error) {
      limited =
        error instanceof FontFormatError && /output limit/.test(error.message);
    }
    return { reports, limited };
  }, vectors);
  for (const [i, vector] of vectors.entries()) {
    expect(result.reports[i].name).toBe(vector.name);
    if (vector.error)
      expect(result.reports[i].formatError, vector.name).toBe(true);
    else
      expect(result.reports[i], vector.name).toEqual({
        name: vector.name,
        length: vector.length,
        sha256: vector.sha256,
        emptySecondary: true,
      });
  }
  expect(result.limited).toBe(true);
});
