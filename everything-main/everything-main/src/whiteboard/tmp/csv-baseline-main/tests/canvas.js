import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
// Use the same bundled fonts as the browser, including French accents.
for (const [weight, style] of [
  [400, "normal"],
  [500, "normal"],
  [600, "normal"],
  [400, "italic"],
  [600, "italic"],
])
  GlobalFonts.registerFromPath(
    new URL(
      `../node_modules/@fontsource/dm-sans/files/dm-sans-latin-${weight}-${style}.woff2`,
      import.meta.url,
    ).pathname,
    "DM Sans",
  );
for (const [slug, name] of [
  ["noto-sans", "Noto Sans"],
  ["eb-garamond", "EB Garamond"],
  ["roboto-mono", "Roboto Mono"],
  ["caveat", "Caveat"],
]) {
  for (const weight of [400, 600])
    for (const style of slug === "caveat" ? ["normal"] : ["normal", "italic"]) {
      GlobalFonts.registerFromPath(
        new URL(
          `../node_modules/@fontsource/${slug}/files/${slug}-latin-${weight}-${style}.woff2`,
          import.meta.url,
        ).pathname,
        name,
      );
    }
}
export { createCanvas };
