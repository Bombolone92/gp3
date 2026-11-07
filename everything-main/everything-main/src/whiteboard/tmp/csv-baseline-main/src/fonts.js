export const FONT_FAMILIES = [
  { id: "dm-sans", name: "DM Sans", fallback: "system-ui, sans-serif" },
  { id: "noto-sans", name: "Noto Sans", fallback: "system-ui, sans-serif" },
  { id: "eb-garamond", name: "EB Garamond", fallback: "Georgia, serif" },
  { id: "roboto-mono", name: "Roboto Mono", fallback: "monospace" },
  { id: "caveat", name: "Caveat", fallback: "cursive" },
];
const families = new Map(FONT_FAMILIES.map((f) => [f.id, f]));
export const validFontFamily = (value) => families.has(value);
export const fontFamily = (i) =>
  validFontFamily(i.fontFamily) ? i.fontFamily : "dm-sans";
export function fontStack(id = "dm-sans") {
  const family = families.get(id) || families.get("dm-sans");
  return `"${family.name}", ${family.fallback}`;
}
const loads = new WeakMap();
export function loadFontFamily(id, fontSet = globalThis.document?.fonts) {
  if (!fontSet?.load) return Promise.resolve();
  id = families.has(id) ? id : "dm-sans";
  let requests = loads.get(fontSet);
  if (!requests) loads.set(fontSet, (requests = new Map()));
  if (!requests.has(id)) {
    const styles = id === "caveat" ? ["normal"] : ["normal", "italic"];
    const promise = Promise.all(
      styles.flatMap((style) =>
        [400, 600].map((weight) =>
          fontSet.load(`${style} ${weight} 16px "${families.get(id).name}"`),
        ),
      ),
    );
    requests.set(id, promise);
  }
  return requests.get(id);
}
export function itemFontFamilies(items) {
  const result = new Set();
  for (const i of items)
    if (i.type !== "image" && i.type !== "pen") result.add(fontFamily(i));
  if (items.some((i) => i.tagIds?.length)) result.add("dm-sans");
  return result;
}
export function loadItemFonts(items, fontSet) {
  return Promise.all(
    [...itemFontFamilies(items)].map((id) => loadFontFamily(id, fontSet)),
  );
}
