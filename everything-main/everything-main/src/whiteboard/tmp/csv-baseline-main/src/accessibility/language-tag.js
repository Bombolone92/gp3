// Language tags are data, never markup. Canonicalization also validates
// region, script and extension subtags accepted by the browser.
export function canonicalLanguage(value) {
  if (typeof value !== "string" || !value || value.length > 64) return null;
  try {
    const tag = Intl.getCanonicalLocales(value)[0];
    return tag && tag.length <= 64 ? tag : null;
  } catch {
    return null;
  }
}
